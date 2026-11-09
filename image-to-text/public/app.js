const drop = document.getElementById("drop");
const fileInput = document.getElementById("file");
const lang = document.getElementById("lang");
const mode = document.getElementById("mode");
const statusEl = document.getElementById("status");
const preview = document.getElementById("preview");
const noPreview = document.getElementById("no-preview");
const output = document.getElementById("output");
const copyBtn = document.getElementById("copy");
const downloadBtn = document.getElementById("download");

let lastName = "ocr-result.txt";

function setBusy(busy, message) {
  statusEl.textContent = message || "";
  copyBtn.disabled = busy || !output.value.trim();
  downloadBtn.disabled = busy || !output.value.trim();
}

async function runOcr(file) {
  lastName = (file.name.replace(/\.[^.]+$/, "") || "ocr-result") + ".txt";
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  noPreview.hidden = true;
  output.value = "";
  setBusy(
    true,
    mode.value === "summary"
      ? "Writing readable summary… (needs GEMINI_API_KEY in .env)"
      : "Scanning with OCR… first run may download language data.",
  );

  const body = new FormData();
  body.append("image", file);

  try {
    const res = await fetch("/api/ocr", {
      method: "POST",
      headers: {
        "x-ocr-lang": lang.value,
        "x-ocr-mode": mode.value,
      },
      body,
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "OCR failed");
    output.value = json.text || "(no readable text found)";
    setBusy(false, `Done · mode: ${json.mode}`);
  } catch (err) {
    setBusy(false, err.message || String(err));
  }
}

drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) runOcr(file);
});

["dragenter", "dragover"].forEach((evt) => {
  drop.addEventListener(evt, (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  });
});

["dragleave", "drop"].forEach((evt) => {
  drop.addEventListener(evt, (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
  });
});

drop.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) runOcr(file);
});

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(output.value);
  statusEl.textContent = "Copied.";
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([output.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = lastName;
  a.click();
  URL.revokeObjectURL(url);
});

output.addEventListener("input", () => {
  copyBtn.disabled = !output.value.trim();
  downloadBtn.disabled = !output.value.trim();
});
