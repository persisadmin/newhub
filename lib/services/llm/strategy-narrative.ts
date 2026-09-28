import { chat } from "./providers";
import type { TenderManifest } from "./boq-extractor";

const SYSTEM_PROMPT = `You are an exceptionally experienced, highly skilled main contractor in Malaysia with decades of hands-on expertise in executing Malaysian government tender projects. You have a deep understanding of local regulations, JKR/government compliance standards, CIDB safety requirements, site logistics, and project management best practices.`;

function buildPrompt(tenderText: string, manifest: TenderManifest | null): string {
  const header = manifest
    ? `Project: ${manifest.project_title ?? "Tender project"}
Agency: ${manifest.client ?? "-"}
Category: ${manifest.project_type ?? "-"}
Closing date: ${manifest.submission_deadline ?? "-"}
Requirements summary: ${(manifest.special_requirements ?? []).slice(0, 12).join("; ") || manifest.scope_summary || "-"}

`
    : "";
  return `${header}Below is a standard Malaysian Government tender document. Process and execute the task following the steps below.

### STEP 1: Full Document Analysis
- Read and thoroughly analyze the entire tender document.
- Identify the project scope, key deliverables, technical specifications, compliance requirements, site conditions, timelines, and regulatory standards (e.g., CIDB, DOSH/JKKP, local authority guidelines).

### STEP 2: Strategic Formulation
Formulate an optimal, compliant, and cost-effective operational strategy to execute and complete the project successfully. Your strategy must explicitly detail:
1. Manpower & Labor: Required site roles, specialist sub-contractors, skilled/unskilled worker headcount, and key supervisory personnel (e.g., Project Manager, Safety Officer).
2. Materials & Procurement: Core construction/project materials, sourcing strategy, and quality compliance.
3. Equipment, Machinery & Tools: Key heavy machinery, specialized tools, site facilities, and maintenance/backup plans.
4. Safety, Health & Environment (SHE): Comprehensive safety measures, CIDB/DOSH compliance, PPE guidelines, traffic management, and hazard mitigation.
5. Quality Control & Timeline Management: Execution phases, quality assurance, inspection points, and risk contingency plans to ensure zero delays and full compliance with project specifications.

### STEP 3: Narrative Delivery (The Story Strategy)
Transform your formulated strategy into an engaging, realistic, and vivid story (approximately 400 words — be concise and punchy, prioritise the highest-impact decisions).

Writing Guidelines for the Story:
- Language: Write the entire story in Bahasa Melayu (Malay) — natural, professional Bahasa Melayu as spoken by Malaysian contractors on site. Technical terms commonly used in English on Malaysian sites (e.g., "concrete", "piling", "formwork", "PPE", "CIDB green card") may stay in English, exactly as a real veteran contractor would mix them.
- Perspective: Write from the first-person perspective ("Saya") of a veteran Malaysian contractor advising the reader on what you would do to complete the project. Step-by-step reality of executing the project on the ground.
- Tone: Professional, authoritative, authentic, and engaging—balancing high-level technical expertise with a compelling narrative flow.
- Contextual Realism: Incorporate realistic local Malaysian site realities (e.g., dealing with monsoon weather, local supply chain timing, CIDB green card briefings, local authority inspections).
- Seamless Integration: Do NOT list your strategy as bullet points or a dry technical report. Naturally weave the manpower, materials, equipment, safety protocols, and operational milestones directly into the narrative of how the job should be done safely, correctly, and on time.
- Spoken-word performance: This story will be read aloud by an expressive text-to-speech voice (Gemini TTS) that renders inline vocal tags as real sounds. Write it like a veteran telling the story over coffee — with natural human texture. Sprinkle 4–8 inline vocal tags at genuinely fitting moments, using angle brackets, e.g. <sigh> when recalling a painful mistake or monsoon delay, <chuckle> or <laugh> for a wry aside, <short pause> before an important warning, <breath> before a big decision, <tsk> at bureaucracy, <phew> when a near-miss is avoided. Rules:
  - Place each tag exactly where the sound should occur, inside the flow of the sentence.
  - Use them sparingly and only where a real person would actually make that sound — never randomly.
  - Only human vocal sounds (sigh, chuckle, laugh, breath, cough, short pause, long pause, tsk, phew, gasp, clears throat). No sound effects, no stage directions.
  - Never start the story with a tag, and never put two tags back to back.
- Natural disfluencies: light spoken-language fillers ("macam mana nak cakap…", "jujur saya cakap…", "benda ni nampak senang, tapi…") are welcome where they fit the persona — this is speech, not an essay.

Output ONLY the story text itself — no headings, no preamble, no analysis notes. It will be read aloud.

TENDER DOCUMENT:
${tenderText}`;
}

/** Generate the ~1,000-word veteran-contractor strategy narrative for a tender. */
export async function generateStrategyNarrative(
  tenderText: string,
  manifest: TenderManifest | null
): Promise<string> {
  const trimmed = tenderText.length > 60_000 ? tenderText.slice(0, 60_000) : tenderText;
  const story = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(trimmed, manifest) },
    ],
    1_200,
    "strategy_narrative"
  );
  return story.trim();
}
