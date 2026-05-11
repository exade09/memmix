const form = document.querySelector("#hybridForm");
const statusText = document.querySelector("#hybridStatus");
const button = document.querySelector("#hybridButton");
const resultSlot = document.querySelector("#hybridResultSlot");
const resultLink = document.querySelector("#hybridResultLink");

const imageAUrl = document.querySelector("#imageAUrl");
const imageBUrl = document.querySelector("#imageBUrl");
const imageAFile = document.querySelector("#imageAFile");
const imageBFile = document.querySelector("#imageBFile");
const imageAPreview = document.querySelector("#imageAPreview");
const imageBPreview = document.querySelector("#imageBPreview");
const imageALabel = document.querySelector("#imageALabel");
const imageBLabel = document.querySelector("#imageBLabel");
const promptInput = document.querySelector("#hybridPrompt");

const previewUrls = new Map();
const uploadableImageTypes = new Set([
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);
const defaultPrompt =
  "Create a coherent hybrid sticker-style character or emblem from these two reference images. Preserve recognizable traits, colors, and shapes from both inputs. Keep the composition clean, high contrast, polished, and centered.";

function setStatus(text) {
  statusText.textContent = text;
}

function setResultMessage(text) {
  resultSlot.innerHTML = "";
  const message = document.createElement("span");
  message.textContent = text;
  resultSlot.append(message);
  resultLink.hidden = true;
}

function setResultImage(url) {
  resultSlot.innerHTML = "";
  const image = document.createElement("img");
  image.src = url;
  image.alt = "Generated token hybrid";
  resultSlot.append(image);
  resultLink.href = url;
  resultLink.hidden = false;
}

function setPreviewFromUrl(img, input, url, label, labelText) {
  input.value = url || "";
  label.textContent = labelText || label.textContent;
  if (!url) {
    img.hidden = true;
    img.removeAttribute("src");
    img.closest(".hybrid-upload")?.classList.remove("has-image");
    return;
  }

  img.src = url;
  img.hidden = false;
  img.closest(".hybrid-upload")?.classList.add("has-image");
}

function setPreviewFromFile(fileInput, img) {
  const file = fileInput.files?.[0];
  const previousUrl = previewUrls.get(fileInput.id);
  if (previousUrl) URL.revokeObjectURL(previousUrl);

  if (!file) {
    previewUrls.delete(fileInput.id);
    updateButton();
    return;
  }

  const url = URL.createObjectURL(file);
  previewUrls.set(fileInput.id, url);
  img.src = url;
  img.hidden = false;
  img.closest(".hybrid-upload")?.classList.add("has-image");
  updateButton();
}

function hasImage(fileInput, urlInput) {
  return Boolean(fileInput.files?.[0] || urlInput.value.trim());
}

function updateButton() {
  button.disabled = !(hasImage(imageAFile, imageAUrl) && hasImage(imageBFile, imageBUrl));
}

async function submitHybrid(event) {
  event.preventDefault();
  updateButton();
  if (button.disabled) return;

  button.disabled = true;
  setStatus("Generating...");
  setResultMessage("Creating hybrid...");

  try {
    const formData = await buildHybridFormData();
    const response = await fetch("/api/hybrid-image", {
      method: "POST",
      body: formData,
    });
    const payload = await readResponsePayload(response);
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    setResultImage(payload.output_url);
    setStatus("Image ready");
  } catch (error) {
    setResultMessage(error.message || "Failed to generate hybrid.");
    setStatus("Generation failed");
  } finally {
    updateButton();
  }
}

async function buildHybridFormData() {
  const formData = new FormData(form);
  await setImageField(formData, "image_a", imageAFile, imageAUrl);
  await setImageField(formData, "image_b", imageBFile, imageBUrl);
  return formData;
}

async function setImageField(formData, fieldName, fileInput, urlInput) {
  const file = fileInput.files?.[0];
  if (file) {
    formData.set(fieldName, file, file.name || `${fieldName}.png`);
    return;
  }

  const url = urlInput.value.trim();
  if (!url) return;

  const blob = await uploadableBlobFromUrl(url);
  if (blob) {
    formData.set(fieldName, blob, `${fieldName}.png`);
  }
}

async function uploadableBlobFromUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (uploadableImageTypes.has(blob.type)) return blob;
    if (blob.type === "image/svg+xml" || url.toLowerCase().includes(".svg")) {
      return await svgBlobToPng(blob);
    }
  } catch (error) {
    return null;
  }
  return null;
}

async function svgBlobToPng(svgBlob) {
  const objectUrl = URL.createObjectURL(svgBlob);
  try {
    const image = await loadImage(objectUrl);
    const size = Math.max(image.naturalWidth || 512, image.naturalHeight || 512, 512);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image preview."));
    image.src = src;
  });
}

async function readResponsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    return { error: text };
  }
}

function loadInitialState() {
  const params = new URLSearchParams(window.location.search);
  const prompt = params.get("prompt") || defaultPrompt;
  const title = params.get("title") || "";
  const ticker = params.get("ticker") || "";

  setPreviewFromUrl(
    imageAPreview,
    imageAUrl,
    params.get("image_a_url") || "",
    imageALabel,
    params.get("image_a_label") || "Image A",
  );
  setPreviewFromUrl(
    imageBPreview,
    imageBUrl,
    params.get("image_b_url") || "",
    imageBLabel,
    params.get("image_b_label") || "Image B",
  );

  promptInput.value = buildProviderFriendlyPrompt(prompt, title, ticker);
  updateButton();
}

function buildProviderFriendlyPrompt(prompt, title, ticker) {
  const base = String(prompt || defaultPrompt)
    .replace(/\bdegen\b/gi, "community")
    .replace(/\braids?\b/gi, "campaign")
    .replace(/\$[A-Za-z0-9_]+/g, "")
    .trim();
  const narrative = [title, ticker].filter(Boolean).join(" ").trim();
  return [
    "Create one polished hybrid sticker-style character or emblem from the two reference images.",
    "Preserve recognizable colors, shapes, and visual identity from both references.",
    "Use a clean centered composition, natural lighting, crisp edges, no UI, no tiny text.",
    base,
  ]
    .filter(Boolean)
    .join("\n");
}

imageAFile.addEventListener("change", () => setPreviewFromFile(imageAFile, imageAPreview));
imageBFile.addEventListener("change", () => setPreviewFromFile(imageBFile, imageBPreview));
form.addEventListener("submit", submitHybrid);

loadInitialState();
