/**
 * lib/sandbox-verversen-regels.js — mag deze branch overschreven worden?
 *
 * Bewust een losse, pure functie in gewoon JavaScript, om twee redenen:
 * hij is te testen zonder Neon-account of database, en hij is in één scherm te
 * lezen. Dit is de controle die voorkomt dat de nachtelijke verversing ooit
 * PRODUCTIE overschrijft met de sandbox — dat wil je niet verstopt hebben in
 * een functie die ook nog HTTP doet.
 *
 * Geeft `null` terug als het veilig is, of een leesbare weigering.
 */

export function weigering({ sandboxAan, apiKey, projectId, doel, bron, branch }) {
  if (!sandboxAan) {
    return 'Weigering: deze omgeving staat niet in sandbox-stand (GENTS_SANDBOX != 1).';
  }
  if (!apiKey || !projectId || !doel || !bron) {
    return 'Weigering: NEON_API_KEY, NEON_PROJECT_ID, NEON_SANDBOX_BRANCH_ID en NEON_PRODUCTIE_BRANCH_ID moeten alle vier gevuld zijn.';
  }
  if (doel === bron) {
    return 'Weigering: de sandbox-branch en de productie-branch zijn hetzelfde ingesteld.';
  }
  if (!branch || branch.id !== doel) {
    return `Weigering: Neon gaf geen gegevens terug voor branch ${doel}.`;
  }

  /* Productie is in Neon altijd de standaard-branch. Staat die als doel
     ingesteld, dan zijn de twee variabelen vrijwel zeker omgewisseld. */
  if (branch.default) {
    return `Weigering: branch ${doel} ("${branch.name}") is de STANDAARD-branch van het project — dat is productie. ` +
      'Waarschijnlijk staan NEON_SANDBOX_BRANCH_ID en NEON_PRODUCTIE_BRANCH_ID omgekeerd.';
  }

  /* De sluitende controle. Verversen gaat van ouder naar kind; een ouder is
     nooit het kind van zijn eigen kind. Wie de twee id's omdraait, kan deze
     eis dus per definitie niet halen — ook niet als de eerdere controles om
     wat voor reden dan ook door zouden laten. */
  if (branch.parent_id !== bron) {
    return `Weigering: branch ${doel} ("${branch.name}") is geen kind van ${bron} ` +
      `(ouder is ${branch.parent_id || 'geen'}). Verversen mag alleen van ouder naar kind.`;
  }

  return null;
}
