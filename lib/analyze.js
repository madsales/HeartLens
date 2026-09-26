import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const MODEL = process.env.HEARTLENS_MODEL || "claude-opus-5";
const EFFORT = process.env.HEARTLENS_EFFORT || "medium";

// Hard caps so a single request can't run up an unbounded bill.
export const LIMITS = { profile: 6000, conversation: 12000, about: 1500 };

const Confidence = z.enum(["low", "medium", "high"]);

export const AnalysisSchema = z.object({
  summary: z.string().describe("Two or three sentences on the overall read of this person and this exchange."),
  interests: z
    .array(
      z.object({
        label: z.string().describe("Short interest or topic, e.g. 'bouldering', 'indie film'."),
        evidence: z.string().describe("The specific phrase or detail this is inferred from."),
        confidence: Confidence,
      }),
    )
    .describe("Likely interests, most strongly supported first. Empty if nothing is supported."),
  communication_style: z.object({
    description: z.string().describe("How they write: length, punctuation, humor, warmth, directness, emoji use."),
    traits: z.array(z.string()).describe("Three to six short trait tags, e.g. 'dry humor', 'asks questions back'."),
    match_tips: z.array(z.string()).describe("Concrete ways to match or complement their style without imitating them."),
  }),
  engagement: z.object({
    level: z.enum(["cold", "lukewarm", "warm", "hot", "unclear"]).describe("How engaged they seem in the conversation. 'unclear' if there is no conversation."),
    signals: z.array(z.string()).describe("What in the text points to that level, both positive and negative."),
  }),
  opener_angles: z
    .array(
      z.object({
        angle: z.string().describe("The idea behind the opener in a few words."),
        why_it_fits: z.string().describe("Why this angle suits this specific person."),
        example: z.string().describe("One natural, ready-to-send message in the user's voice. No pickup lines, no negging, no pressure."),
      }),
    )
    .min(1)
    .max(5)
    .describe("Angles for a first message, or for the next message if a conversation is already going."),
  avoid: z.array(z.string()).describe("Topics or moves that would land badly with this person, based on the text."),
  caution: z
    .array(z.string())
    .describe("Anything the user should be careful about for their own sake: inconsistencies, scam patterns, pressure tactics, or clear signs the other person isn't interested. Empty if nothing stands out."),
  confidence_note: z.string().describe("One sentence on how much text there was to go on and how much to trust this."),
});

const SYSTEM_PROMPT = `You are HeartLens, a thoughtful friend who is good at reading people from how they write. A user gives you a dating or social profile and, optionally, a conversation they are having with that person. You help the user understand the other person better and figure out what to say next.

How to work:
- Ground every claim in the text you were given. Quote or paraphrase the evidence. If the text does not support a claim, do not make it.
- These are estimates about a real person, not facts. Use confidence levels honestly, and say so when there is little to go on.
- Do not guess at protected or sensitive attributes (sexual orientation, ethnicity, religion, health, politics, income) unless the person states them outright, and even then only use them if they are relevant to the user's question.
- Openers must be genuine, specific to this person, and respectful. Never suggest manipulation, negging, false urgency, love-bombing, lying, or pressure tactics. Write them the way a warm, confident person would text.
- If the other person seems uninterested, has said no, or has stopped replying, say so plainly and suggest respecting that instead of a workaround.
- Look out for the user too: note inconsistencies, requests for money or off-platform contact too early, or other patterns common in scams.
- Keep the tone warm and direct. No filler.

Populate every field of the requested schema. Write the opener examples in the user's voice if they told you about themselves; otherwise keep them neutral and easy to adapt.`;

function clamp(text, max) {
  const t = (text || "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

export function buildUserMessage({ profile, conversation, about }) {
  const parts = [];
  if (about) parts.push(`<about_the_user>\n${about}\n</about_the_user>`);
  parts.push(`<their_profile>\n${profile || "(not provided)"}\n</their_profile>`);
  parts.push(`<conversation>\n${conversation || "(no conversation yet — this will be a first message)"}\n</conversation>`);
  parts.push(
    conversation
      ? "Read this person and suggest what I should say next."
      : "Read this person and suggest how I should open.",
  );
  return parts.join("\n\n");
}

let client;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Analyze a profile and optional conversation. Returns the parsed analysis.
 * Throws an Error with a `status` field for user-facing failures.
 */
export async function analyze(input) {
  const profile = clamp(input.profile, LIMITS.profile);
  const conversation = clamp(input.conversation, LIMITS.conversation);
  const about = clamp(input.about, LIMITS.about);

  if (!profile && !conversation) {
    throw Object.assign(new Error("Paste a profile, a conversation, or both."), { status: 400 });
  }

  if (process.env.HEARTLENS_MOCK) return mockAnalysis({ profile, conversation });

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserMessage({ profile, conversation, about }) }],
    output_config: { format: zodOutputFormat(AnalysisSchema), effort: EFFORT },
  });

  if (response.stop_reason === "refusal") {
    const why = response.stop_details?.explanation;
    throw Object.assign(
      new Error(why ? `The model declined this request: ${why}` : "The model declined this request."),
      { status: 422 },
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw Object.assign(new Error("The analysis was cut off. Try with less text."), { status: 502 });
  }
  if (!response.parsed_output) {
    throw Object.assign(new Error("The model returned an unreadable analysis. Please try again."), { status: 502 });
  }
  return response.parsed_output;
}

// Returned when HEARTLENS_MOCK is set, so the UI can be developed without an API key.
function mockAnalysis({ profile, conversation }) {
  return {
    summary:
      "MOCK RESULT (no API key). This is sample output so you can see the layout. Set ANTHROPIC_API_KEY and unset HEARTLENS_MOCK for real analysis.",
    interests: [
      { label: "hiking", evidence: `"${profile.slice(0, 40) || "weekend trail"}"`, confidence: "medium" },
      { label: "cooking", evidence: "mentions making pasta from scratch", confidence: "high" },
    ],
    communication_style: {
      description: "Short, playful messages with a fair amount of lowercase and the occasional emoji.",
      traits: ["playful", "brief", "asks questions back", "self-deprecating"],
      match_tips: ["Keep it light and short.", "Answer their question, then ask one back."],
    },
    engagement: {
      level: conversation ? "warm" : "unclear",
      signals: conversation ? ["Replies within a few minutes", "Asks follow-up questions"] : ["No conversation yet"],
    },
    opener_angles: [
      {
        angle: "The pasta claim",
        why_it_fits: "It is the most specific thing in the profile and invites a bit of friendly challenge.",
        example: "Okay, 'pasta from scratch' is a bold claim. What's the one dish you'd stake your reputation on?",
      },
      {
        angle: "Trail recommendation",
        why_it_fits: "Shared-activity openers are easy to answer and lead somewhere.",
        example: "Your hiking photo looks like the Cascades? I need a new trail for Saturday, any picks?",
      },
    ],
    avoid: ["Generic 'hey, how's your week' openers", "Commenting on appearance first"],
    caution: [],
    confidence_note: "Mock output. Nothing here was actually inferred from your text.",
  };
}
