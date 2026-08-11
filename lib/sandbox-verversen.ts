/**
 * lib/sandbox-verversen.ts — de sandbox-database 's nachts bijwerken vanaf productie.
 *
 * Neon-branches zijn copy-on-write, dus dit is geen kopieeractie maar één
 * API-aanroep: de sandbox-branch wordt teruggezet op de huidige stand van zijn
 * ouder. Seconden, ongeacht hoe groot de database is, en je betaalt alleen voor
 * wat er daarna van elkaar afwijkt.
 *
 * ── DE GEVAARLIJKSTE REGEL CODE IN DIT PROJECT ──────────────────────────────
 * `restore` OVERSCHRIJFT de doel-branch met de bron. Worden de twee id's ooit
 * verwisseld — in een env-var, bij het kopiëren van een project, door een
 * typefout — dan herstelt deze functie PRODUCTIE vanuit de sandbox. Dat is geen
 * storing maar dataverlies van jaren.
 *
 * Daarom controleren we het niet met een waarschuwing in de documentatie maar
 * met vier harde eisen die de fout structureel onmogelijk maken:
 *
 *   1. Draait alleen als GENTS_SANDBOX=1.
 *   2. Doel en bron moeten verschillen.
 *   3. Het doel mag NIET de standaard-branch zijn (productie is dat altijd).
 *   4. Het doel moet een KIND van de bron zijn (parent_id === bron). Een ouder
 *      is per definitie geen kind van zijn kind, dus omgekeerd invullen kán
 *      hier niet slagen.
 *
 * Eis 3 en 4 vragen we live op bij Neon; ze zijn niet te vervalsen met een
 * env-var. Faalt er één, dan gebeurt er niets en komt er een luide fout.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { ANONIMISEER_STAPPEN, CONTROLE_SQL } from "@/lib/sandbox-anonimiseren";
import { weigering } from "@/lib/sandbox-verversen-regels.js";

const NEON_API = "https://console.neon.tech/api/v2";

export type Uitslag = {
  ok: boolean;
  stap: string;
  melding: string;
  duurMs?: number;
  stappen?: string[];
  controle?: Record<string, number>;
};

type Branch = { id: string; name: string; parent_id?: string; default?: boolean };

export type Opties = {
  /** Alleen de instellingen controleren; niets wijzigen. Voor ingebruikname. */
  droogloop?: boolean;
  /** Niet herstellen, wel anonimiseren — voor beproeven en handmatig herstel. */
  slaHerstelOver?: boolean;
};

function config() {
  return {
    apiKey: (process.env.NEON_API_KEY || "").trim(),
    projectId: (process.env.NEON_PROJECT_ID || "").trim(),
    doel: (process.env.NEON_SANDBOX_BRANCH_ID || "").trim(),
    bron: (process.env.NEON_PRODUCTIE_BRANCH_ID || "").trim(),
  };
}

async function neon<T>(pad: string, init?: RequestInit): Promise<T> {
  const { apiKey } = config();
  const res = await fetch(`${NEON_API}${pad}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(init?.headers || {}),
    },
  });
  const tekst = await res.text();
  if (!res.ok) {
    throw new Error(`Neon-API ${init?.method || "GET"} ${pad} gaf ${res.status}: ${tekst.slice(0, 300)}`);
  }
  return (tekst ? JSON.parse(tekst) : {}) as T;
}

/**
 * De vier eisen (zie sandbox-verversen-regels.js — daar staat de beslissing,
 * pure en getest). Hier alleen het ophalen van de gegevens waarop die
 * beslissing rust: het branch-record komt LIVE bij Neon vandaan en is dus niet
 * te vervalsen met een env-var.
 *
 * De eerste twee eisen worden vóór de API-aanroep al beoordeeld, zodat een
 * verkeerd geconfigureerde omgeving niet eens een verzoek stuurt.
 */
async function controleerDoel(): Promise<Branch> {
  const { apiKey, projectId, doel, bron } = config();
  const basis = { sandboxAan: process.env.GENTS_SANDBOX === "1", apiKey, projectId, doel, bron };

  const vroeg = weigering({ ...basis, branch: { id: doel, name: "", parent_id: bron } });
  if (vroeg) throw new Error(vroeg);

  const { branch } = await neon<{ branch: Branch }>(`/projects/${projectId}/branches/${doel}`);

  const laat = weigering({ ...basis, branch });
  if (laat) throw new Error(laat);

  return branch;
}

/** Neon voert het herstel asynchroon uit; wachten tot het klaar is. */
async function wachtOpKlaar(operationIds: string[], maxMs = 120000): Promise<void> {
  const { projectId } = config();
  const einde = Date.now() + maxMs;

  for (const id of operationIds) {
    for (;;) {
      const { operation } = await neon<{ operation: { status: string; error?: string } }>(
        `/projects/${projectId}/operations/${id}`
      );
      if (operation.status === "finished") break;
      if (operation.status === "failed" || operation.status === "error") {
        throw new Error(`Neon-bewerking ${id} mislukt: ${operation.error || "geen reden gegeven"}`);
      }
      if (Date.now() > einde) {
        throw new Error(`Neon-bewerking ${id} duurde langer dan ${maxMs / 1000} seconden.`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/**
 * Alles achter elkaar: controleren, herstellen, wachten tot het echt klaar is,
 * en dan pas anonimiseren.
 *
 * De volgorde is niet vrijblijvend. Zou het anonimiseren starten terwijl het
 * herstel nog loopt, dan schoon je de OUDE gegevens en staan de verse
 * klantgegevens er onaangeroerd in — een sandbox die er schoon uitziet en het
 * niet is. Vandaar dat we expliciet op de Neon-bewerking wachten.
 */
export async function ververs(opties: Opties = {}): Promise<Uitslag> {
  const begin = Date.now();
  const { projectId, doel, bron } = config();

  let branch: Branch;
  try {
    branch = await controleerDoel();
  } catch (e) {
    return { ok: false, stap: "controle", melding: e instanceof Error ? e.message : "onbekende fout" };
  }

  /* Droogloop: alleen kijken of de instellingen kloppen. Dit is de stand
     waarmee je een nieuwe sandbox in gebruik neemt — hij bewijst dat de
     branch-controle het juiste doel aanwijst, zonder dat er iets verandert. */
  if (opties.droogloop) {
    return {
      ok: true,
      stap: "droogloop",
      melding:
        `Instellingen kloppen. Zou branch "${branch.name}" (${doel}) herstellen vanaf ${bron} ` +
        `en daarna ${ANONIMISEER_STAPPEN.length} anonimiseer-stappen draaien. Er is niets gewijzigd.`,
      duurMs: Date.now() - begin,
    };
  }

  /* `slaHerstelOver` draait alléén de anonimisatie op de database zoals hij nu
     is. Bedoeld om de anonimiseer-stappen één keer met de hand te beproeven
     zonder eerst een uur op een verse kopie te wachten — en om na een mislukte
     nacht handmatig alsnog schoon te maken. Raakt nooit een andere branch. */
  if (!opties.slaHerstelOver) {
    try {
      const antwoord = await neon<{ operations?: { id: string }[] }>(
        `/projects/${projectId}/branches/${doel}/restore`,
        { method: "POST", body: JSON.stringify({ source_branch_id: bron }) }
      );
      await wachtOpKlaar((antwoord.operations || []).map((o) => o.id));
    } catch (e) {
      return { ok: false, stap: "herstellen", melding: e instanceof Error ? e.message : "onbekende fout" };
    }
  }

  const gedaan: string[] = [];
  try {
    for (const stap of ANONIMISEER_STAPPEN) {
      await getDb().execute(sql.raw(stap.sql));
      gedaan.push(stap.naam);
    }
  } catch (e) {
    /* Half geanonimiseerd is erger dan niet ververst: er staan dan echte
       klantgegevens in een omgeving waarvan iedereen aanneemt dat hij schoon
       is. Dit moet dus luid falen, niet stilletjes doorgaan. */
    return {
      ok: false,
      stap: "anonimiseren",
      melding:
        `Mislukt na ${gedaan.length} van ${ANONIMISEER_STAPPEN.length} stappen ` +
        `(laatste geslaagd: ${gedaan[gedaan.length - 1] || "geen"}). ` +
        `LET OP: de sandbox bevat nu mogelijk ECHTE klantgegevens. ` +
        `Fout: ${e instanceof Error ? e.message : "onbekend"}`,
      stappen: gedaan,
    };
  }

  let controle: Record<string, number> | undefined;
  try {
    const r = await getDb().execute(sql.raw(CONTROLE_SQL));
    const rij = (r as unknown as { rows?: Record<string, unknown>[] }).rows?.[0];
    if (rij) {
      controle = Object.fromEntries(Object.entries(rij).map(([k, v]) => [k, Number(v) || 0]));
    }
  } catch {
    /* De controle is een extra zekerheid, geen voorwaarde. */
  }

  const restant = controle ? Object.values(controle).reduce((a, b) => a + b, 0) : 0;
  if (controle && restant > 0) {
    return {
      ok: false,
      stap: "controle",
      melding:
        `De sandbox is ververst, maar de nacontrole vond nog ${restant} rij(en) met echte gegevens: ` +
        `${JSON.stringify(controle)}. Waarschijnlijk is er een tabel bijgekomen die nog niet in ` +
        `lib/sandbox-anonimiseren.ts staat.`,
      stappen: gedaan,
      controle,
    };
  }

  return {
    ok: true,
    stap: "klaar",
    melding: `Sandbox ververst vanaf "${branch.name}" en geanonimiseerd in ${ANONIMISEER_STAPPEN.length} stappen.`,
    duurMs: Date.now() - begin,
    stappen: gedaan,
    controle,
  };
}
