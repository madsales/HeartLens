const form = document.getElementById("analyze-form");
const submit = document.getElementById("submit");
const status = document.getElementById("status");
const errorEl = document.getElementById("error");
const results = document.getElementById("results");

const STORAGE_KEY = "heartlens.draft";

// Keep the draft in this browser only, so a refresh doesn't lose a pasted chat.
for (const id of ["profile", "conversation", "about"]) {
  const el = document.getElementById(id);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (saved[id]) el.value = saved[id];
  } catch {}
  el.addEventListener("input", saveDraft);
}

function saveDraft() {
  try {
    const draft = {};
    for (const id of ["profile", "conversation", "about"]) draft[id] = document.getElementById(id).value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {}
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    profile: form.profile.value.trim(),
    conversation: form.conversation.value.trim(),
    about: form.about.value.trim(),
  };

  hideError();
  if (!payload.profile && !payload.conversation) {
    showError("Paste a profile, a conversation, or both.");
    return;
  }

  setBusy(true);
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showError(data.error || `Request failed (${res.status}).`);
      return;
    }
    render(data.result, data.model);
  } catch (err) {
    showError("Couldn't reach the server. Is it running?");
  } finally {
    setBusy(false);
  }
});

function setBusy(busy) {
  submit.disabled = busy;
  status.textContent = busy ? "Reading the signals…" : "";
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}
function hideError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

// --- Rendering -------------------------------------------------------------

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function list(items, className) {
  if (!items || !items.length) return null;
  return el("ul", { class: className || "" }, items.map((t) => el("li", { text: t })));
}

function render(r, model) {
  results.replaceChildren();

  results.append(
    el("section", { class: "card" }, [
      el("h3", { text: "The read" }),
      el("p", { text: r.summary }),
      el("p", { class: "fine", text: r.confidence_note }),
    ]),
  );

  if (r.caution && r.caution.length) {
    results.append(
      el("section", { class: "card caution" }, [
        el("h3", { text: "Look out for yourself" }),
        list(r.caution),
      ]),
    );
  }

  results.append(
    el("div", { class: "two-col" }, [
      el("section", { class: "card" }, [
        el("h3", { text: "Likely interests" }),
        r.interests.length
          ? el(
              "ul",
              { class: "tags" },
              r.interests.map((i) =>
                el("li", { class: i.confidence, title: i.evidence }, [
                  i.label,
                  el("span", { class: "conf", text: i.confidence }),
                ]),
              ),
            )
          : el("p", { class: "fine", text: "Not enough to go on." }),
        r.interests.length
          ? el(
              "ul",
              { class: "evidence" },
              r.interests.map((i) => el("li", { text: `${i.label}: ${i.evidence}` })),
            )
          : null,
      ]),
      el("section", { class: "card" }, [
        el("h3", { text: "How engaged they seem" }),
        el("span", { class: `badge ${r.engagement.level}`, text: r.engagement.level }),
        list(r.engagement.signals),
      ]),
    ]),
  );

  results.append(
    el("section", { class: "card" }, [
      el("h3", { text: "Communication style" }),
      el("p", { text: r.communication_style.description }),
      list(r.communication_style.traits, "tags"),
      r.communication_style.match_tips.length ? el("h4", { text: "Matching their style" }) : null,
      list(r.communication_style.match_tips),
    ]),
  );

  results.append(
    el("section", { class: "card" }, [
      el("h3", { text: form.conversation.value.trim() ? "What to say next" : "Opener angles" }),
      ...r.opener_angles.map((o) => {
        const quote = el("blockquote", { text: o.example });
        const copy = el("button", { type: "button", class: "copy", text: "Copy" });
        copy.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(o.example);
            copy.textContent = "Copied";
            setTimeout(() => (copy.textContent = "Copy"), 1500);
          } catch {
            copy.textContent = "Select and copy manually";
          }
        });
        return el("div", { class: "opener" }, [
          el("h4", { text: o.angle }),
          el("p", { class: "why", text: o.why_it_fits }),
          quote,
          copy,
        ]);
      }),
    ]),
  );

  if (r.avoid && r.avoid.length) {
    results.append(el("section", { class: "card" }, [el("h3", { text: "Probably avoid" }), list(r.avoid)]));
  }

  results.append(
    el("p", {
      class: "fine",
      text: `Generated by ${model}. These are probability-based estimates about a real person, not facts. Use your own judgment.`,
    }),
  );

  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}
