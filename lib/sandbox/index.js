/**
 * lib/sandbox/index.js — één regel om een bestand sandbox-veilig te maken.
 *
 *   import '../../lib/sandbox/index.js';
 *
 * Meer is het niet. Buiten de sandbox doet deze import niets (geen patch, geen
 * kosten, geen gedragsverandering) — daarom mag hij zonder nadenken bovenaan
 * elk bestand dat naar buiten belt. `scripts/sandbox-check.mjs` bewaakt dat er
 * geen bestand vergeten wordt.
 *
 * Waarom een import en geen aanroep: een import is niet per ongeluk te vergeten
 * in een codepad, en draait gegarandeerd vóór de rest van de module. Een
 * `installeer()`-aanroep ergens in een handler zou pas draaien nadat een andere
 * import misschien al een verzoek had gedaan.
 */

import { installeerNetSlot } from './net-slot.js';

installeerNetSlot();

export { isSandbox, sandboxNaam } from './env.js';
