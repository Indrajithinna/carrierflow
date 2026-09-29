const $ = (id) => document.getElementById(id);
let snapshot = null,
  mapping = null,
  activeId = null,
  capturedUrl = null;
const status = (text) => {
  $("status").textContent = text;
};
let capturedApplication = null;
let capturedToken = null;
let generation = 0;
function invalidateMapping() {
  generation++;
  mapping = null;
  snapshot = null;
  capturedApplication = null;
  capturedToken = null;
  $("fill").hidden = true;
  $("decisions").replaceChildren();
}
$("application").addEventListener("change", () => {
  invalidateMapping();
  status("Application changed. Review this form again before filling.");
});
$("token").addEventListener("input", invalidateMapping);
async function request(path, body) {
  const res = await fetch("http://localhost:4310/api/companion/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + $("token").value,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}
$("connect").onclick = async () => {
  invalidateMapping();
  try {
    const apps = await request("applications");
    await chrome.storage.local.set({ careerflowToken: $("token").value });
    $("application").replaceChildren();
    for (const a of apps) {
      const option = document.createElement("option");
      option.value = a.id;
      option.textContent = a.job.company + " — " + a.job.title;
      $("application").append(option);
    }
    status(
      apps.length
        ? "Connected. Open the saved job's application page."
        : "Save an application in Careerflow first.",
    );
    $("capture").disabled = !apps.length;
  } catch (e) {
    status(e.message || "Start Careerflow at localhost:4310 first.");
  }
};
chrome.storage.local.get("careerflowToken").then((v) => {
  if (v.careerflowToken) $("token").value = v.careerflowToken;
});
$("capture").onclick = async () => {
  invalidateMapping();
  const captureGeneration = generation;
  const applicationId = $("application").value;
  const pairingToken = $("token").value;
  mapping = null;
  $("fill").hidden = true;
  $("decisions").replaceChildren();
  $("capture").disabled = true;
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    activeId = tab.id;
    capturedUrl = tab.url;
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeId },
      func: () => {
        const controls = [
          ...document.querySelectorAll("input,select,textarea"),
        ].filter(
          (el) =>
            el.getClientRects().length &&
            el.type !== "hidden" &&
            !el.disabled &&
            !["submit", "button", "reset"].includes(el.type),
        );
        const blockers = [
          ...document.querySelectorAll(
            'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],.g-recaptcha,.h-captcha',
          ),
        ].filter((el) => el.getClientRects().length);
        if (blockers.length)
          return [
            {
              label: "CAPTCHA verification",
              type: "captcha",
              selector: "blocker",
              required: true,
            },
          ];
        if (document.querySelector('input[type="password"]'))
          return [
            {
              label: "Login or account creation",
              type: "password",
              selector: "blocker",
              required: true,
            },
          ];
        return controls.slice(0, 100).map((el, i) => {
          const id = "cf-" + Date.now() + "-" + i;
          el.setAttribute("data-careerflow-field", id);
          const label =
            [...(el.labels || [])].map((l) => l.textContent.trim()).join(" ") ||
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            el.name ||
            "Unlabeled field";
          return {
            selector: id,
            label: label.slice(0, 500),
            type: el.tagName === "SELECT" ? "select" : el.type || "text",
            required: !!el.required,
            ...(el.tagName === "SELECT"
              ? {
                  options: [...el.options]
                    .map((o) => o.textContent.trim())
                    .slice(0, 100),
                }
              : {}),
          };
        });
      },
    });
    snapshot = results[0].result;
    if (!snapshot.length) {
      status(
        "No supported visible fields found. Open the application form first.",
      );
      return;
    }
    status("Mapping " + snapshot.length + " fields…");
    const resultMapping = await request("map", {
      applicationId,
      pageUrl: capturedUrl,
      form_snapshot: snapshot,
    });
    if (
      captureGeneration !== generation ||
      applicationId !== $("application").value ||
      pairingToken !== $("token").value
    ) {
      invalidateMapping();
      status("Workspace or application changed. Review the form again.");
      return;
    }
    capturedApplication = applicationId;
    capturedToken = pairingToken;
    mapping = resultMapping;
    for (const f of mapping.fields) {
      const card = document.createElement("article"),
        title = document.createElement("strong"),
        value = document.createElement("div"),
        tag = document.createElement("small");
      title.textContent = f.label;
      value.textContent = f.value || f.reason_if_flagged;
      tag.textContent = f.action;
      card.append(title, tag, value);
      $("decisions").append(card);
    }
    if (mapping.blocking_issue) {
      status(mapping.blocking_issue);
      return;
    }
    status(
      "Review the values below. Flagged fields and files need your input.",
    );
    $("fill").hidden = false;
  } catch (e) {
    status(
      e.message ||
        "This page cannot be accessed. Use a regular application page.",
    );
  } finally {
    $("capture").disabled = false;
  }
};
$("fill").onclick = async () => {
  if (!mapping || mapping.blocking_issue) return;
  if (
    capturedApplication !== $("application").value ||
    capturedToken !== $("token").value
  ) {
    invalidateMapping();
    status("Selection changed. Review this form again.");
    return;
  }
  try {
    const tab = await chrome.tabs.get(activeId);
    if (tab.url !== capturedUrl)
      throw new Error("The page changed. Capture the form again.");
    const result = await chrome.scripting.executeScript({
      target: { tabId: activeId },
      args: [mapping.fields, snapshot],
      func: (fields, capturedFields) => {
        if (
          document.querySelector(
            'input[type="password"],iframe[src*="recaptcha"],iframe[src*="hcaptcha"],.g-recaptcha,.h-captcha',
          )
        )
          return { filled: 0, skipped: fields.length, blocked: true };
        let filled = 0,
          skipped = 0;
        for (const f of fields) {
          if (
            f.action === "FLAG" ||
            !f.value ||
            f.value.startsWith("UPLOAD:")
          ) {
            skipped++;
            continue;
          }
          const el = [
            ...document.querySelectorAll("[data-careerflow-field]"),
          ].find((e) => e.getAttribute("data-careerflow-field") === f.selector);
          const original = capturedFields.find(
            (x) => x.selector === f.selector,
          );
          const currentLabel =
            el &&
            ([...(el.labels || [])]
              .map((l) => l.textContent.trim())
              .join(" ") ||
              el.getAttribute("aria-label") ||
              el.getAttribute("placeholder") ||
              el.name ||
              "Unlabeled field");
          if (
            el &&
            (!original ||
              currentLabel.slice(0, 500) !== original.label ||
              (el.tagName === "SELECT" ? "select" : el.type || "text") !==
                original.type)
          ) {
            return { filled, skipped: fields.length - filled, blocked: true };
          }
          if (
            !el ||
            el.value ||
            !el.getClientRects().length ||
            el.disabled ||
            el.readOnly ||
            ["file", "hidden", "password", "checkbox", "radio"].includes(
              el.type,
            )
          ) {
            skipped++;
            continue;
          }
          if (el.tagName === "SELECT") {
            const option = [...el.options].find(
              (o) => o.textContent.trim() === f.value,
            );
            if (!option) {
              skipped++;
              continue;
            }
            el.value = option.value;
          } else {
            const proto =
              el.tagName === "TEXTAREA"
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (!setter) {
              skipped++;
              continue;
            }
            setter.call(el, f.value);
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          const accepted =
            el.tagName === "SELECT"
              ? el.options[el.selectedIndex]?.textContent.trim()
              : el.value;
          if (accepted === f.value) filled++;
          else skipped++;
        }
        return { filled, skipped };
      },
    });
    const out = result[0].result;
    status(
      out.blocked
        ? "A verification or login wall appeared. Complete it yourself and capture again."
        : out.filled +
            " fields filled. " +
            out.skipped +
            " fields need manual review. Attach your approved files, check every answer, then submit yourself.",
    );
    $("fill").hidden = true;
  } catch (e) {
    status(e.message);
  }
};
