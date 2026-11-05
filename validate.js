const fs = require("node:fs");
const path = require("node:path");

const CDN_PREFIX = "https://cdn.jsdelivr.net/gh/ugnius-dev/jaunimelis-static";
const rootDirectory = __dirname;
const indexFilePath = path.join(rootDirectory, "interviews", "index.json");

const errors = [];
const checkedFiles = new Set();

function report(filePath, message) {
  errors.push(`${path.relative(rootDirectory, filePath)}: ${message}`);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    report(filePath, "file does not exist");
    return null;
  }

  checkedFiles.add(filePath);

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    report(filePath, `invalid JSON (${error.message})`);
    return null;
  }
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function validateLinks(value, filePath, location = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateLinks(item, filePath, `${location}[${index}]`),
    );
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) =>
      validateLinks(item, filePath, `${location}.${key}`),
    );
    return;
  }

  if (isHttpUrl(value) && !value.startsWith(CDN_PREFIX)) {
    report(filePath, `${location} uses a URL outside CDN_PREFIX: ${value}`);
  }
}

function validatePublish(value, filePath, location) {
  if (value === null || value === undefined || value === "") {
    return;
  }

  if (typeof value !== "string" || !value.trim()) {
    report(filePath, `${location} must be null, empty, or an ISO-8601 string`);
    return;
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !/[tT]/.test(value)) {
    report(filePath, `${location} is not a valid ISO-8601 timestamp: ${value}`);
  }
}

function validatePhotoUrl(value, filePath, location, expectedBasename) {
  if (typeof value !== "string" || !value.startsWith(CDN_PREFIX)) {
    report(filePath, `${location} must start with CDN_PREFIX`);
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    report(filePath, `${location} is not a valid URL`);
    return;
  }

  const relativePath = decodeURIComponent(url.pathname)
    .replace(/^\/+/, "")
    .split("/");
  const fileName = relativePath.at(-1) || "";
  const folderName = relativePath.at(-2) || "";

  if (!fileName.toLowerCase().endsWith(".webp")) {
    report(filePath, `${location} must point to a .webp file`);
  }
  if (folderName !== expectedBasename) {
    report(
      filePath,
      `${location} must be inside photos/${expectedBasename}/`,
    );
  }
}

function validateInterview(interview, filePath) {
  if (!interview || typeof interview !== "object" || Array.isArray(interview)) {
    report(filePath, "interview must be a JSON object");
    return;
  }

  if (typeof interview.name !== "string" || !interview.name.trim()) {
    report(filePath, "name must be a non-empty string");
  }

  const basename = path.basename(filePath, ".json");
  validatePhotoUrl(interview.photo, filePath, "$.photo", basename);

  if (!Array.isArray(interview.blocks)) {
    report(filePath, "blocks must be an array");
    return;
  }

  interview.blocks.forEach((block, index) => {
    const location = `$.blocks[${index}]`;
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      report(filePath, `${location} must be an object`);
      return;
    }

    if (!["question", "answer", "image"].includes(block.type)) {
      report(filePath, `${location}.type must be question, answer, or image`);
    }
    if (typeof block.content !== "string" || !block.content.trim()) {
      report(filePath, `${location}.content must be a non-empty string`);
    }

    if (block.type === "image") {
      validatePhotoUrl(
        block.content,
        filePath,
        `${location}.content`,
        basename,
      );
      if (typeof block.alt !== "string" || !block.alt.trim()) {
        report(filePath, `${location}.alt must be a non-empty string`);
      }
    }
  });
}

function resolveIndexFileReference(reference, indexFilePath) {
  if (typeof reference !== "string" || !reference.trim()) {
    return null;
  }

  if (reference.startsWith(CDN_PREFIX)) {
    try {
      const url = new URL(reference);
      const cdnPath = new URL(CDN_PREFIX).pathname.replace(/\/+$/, "");
      const repositoryPath = decodeURIComponent(url.pathname).replace(
        `${cdnPath}/`,
        "",
      );
      return path.resolve(rootDirectory, repositoryPath);
    } catch {
      return null;
    }
  }

  if (isHttpUrl(reference)) {
    return null;
  }

  return path.resolve(path.dirname(indexFilePath), reference);
}

function validateIndex(index, indexFilePath) {
  if (!Array.isArray(index)) {
    report(indexFilePath, "index must be an array");
    return;
  }

  index.forEach((entry, index) => {
    const location = `$[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      report(indexFilePath, `${location} must be an object`);
      return;
    }

    if (typeof entry.slug !== "string" || !entry.slug.trim()) {
      report(indexFilePath, `${location}.slug must be a non-empty string`);
    }
    if (typeof entry.name !== "string" || !entry.name.trim()) {
      report(indexFilePath, `${location}.name must be a non-empty string`);
    }

    const reference = resolveIndexFileReference(entry.file, indexFilePath);
    if (!reference) {
      report(
        indexFilePath,
        `${location}.file must be a CDN URL or repository-relative JSON path`,
      );
    } else {
      if (path.extname(reference).toLowerCase() !== ".json") {
        report(indexFilePath, `${location}.file must point to a JSON file`);
      }
      if (!fs.existsSync(reference)) {
        report(indexFilePath, `${location}.file does not exist: ${entry.file}`);
        } else {
          const referencedJson = readJson(reference);
          if (referencedJson !== null) {
            validateLinks(referencedJson, reference);
          }
        }
      }

    const basename = reference ? path.basename(reference, ".json") : null;
    validatePhotoUrl(entry.photo, indexFilePath, `${location}.photo`, basename);
    validatePublish(entry.publish, indexFilePath, `${location}.publish`);
  });
}

const index = readJson(indexFilePath);
if (index !== null) {
  validateLinks(index, indexFilePath);
  validateIndex(index, indexFilePath);
}

const interviewDirectory = path.dirname(indexFilePath);
for (const fileName of fs.readdirSync(interviewDirectory)) {
  if (fileName === path.basename(indexFilePath) || !fileName.endsWith(".json")) {
    continue;
  }

  const filePath = path.join(interviewDirectory, fileName);
  const interview = readJson(filePath);
  if (interview !== null) {
    validateLinks(interview, filePath);
    validateInterview(interview, filePath);
  }
}

if (errors.length > 0) {
  console.error(`JSON validation failed with ${errors.length} error(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`JSON validation passed (${checkedFiles.size} files checked).`);

  const plannedInterviews = index
    .filter(
      (entry) =>
        entry &&
        typeof entry.publish === "string" &&
        Number.isFinite(new Date(entry.publish).getTime()) &&
        new Date(entry.publish) > new Date(),
    )
    .sort((a, b) => new Date(a.publish) - new Date(b.publish));

  console.log("\nPlanned interviews:");
  if (plannedInterviews.length === 0) {
    console.log("None");
  } else {
    plannedInterviews.forEach((entry) => {
      console.log(`- ${entry.publish}: ${entry.name} (${entry.slug})`);
    });
  }
}
