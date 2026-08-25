const els = {
  collectBtn: document.getElementById("collectBtn"),
  copyBtn: document.getElementById("copyBtn"),
  jsonBtn: document.getElementById("jsonBtn"),
  csvBtn: document.getElementById("csvBtn"),
  status: document.getElementById("status"),
  confidence: document.getElementById("confidence"),
  platform: document.getElementById("platform"),
  productId: document.getElementById("productId"),
  skuId: document.getElementById("skuId"),
  price: document.getElementById("price"),
  output: document.getElementById("output")
};

let latestResult = null;

document.addEventListener("DOMContentLoaded", initializePopup);
els.collectBtn.addEventListener("click", collectCurrentTab);
els.copyBtn.addEventListener("click", copyJson);
els.jsonBtn.addEventListener("click", () => downloadJson(latestResult));
els.csvBtn.addEventListener("click", () => downloadCsv(latestResult));

setActionEnabled(false);

const DEFAULT_API_CONFIG = {
  enabled: false,
  endpoint: "",
  method: "POST",
  timeoutMs: 15000,
  reporter: "chrome-ext v1.0.0",
  headers: {
    "Content-Type": "application/json"
  }
};

async function initializePopup() {
  await chrome.storage.local.remove("latestProduct");
  setStatus("打开商品页后点击采集");
}

async function collectCurrentTab() {
  setBusy(true);
  setStatus("正在读取当前页面");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) {
      throw new Error("当前标签页不是普通网页，无法采集。");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/collector.js"],
      world: "MAIN"
    });

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__productCollectorCollect(),
      world: "MAIN"
    });

    const result = injection?.result;
    if (!result || typeof result !== "object") {
      throw new Error("页面没有返回可用的采集结果。");
    }

    renderResult(result);
    setStatus("采集完成，正在发送");
    const apiResult = await sendResultToApi(result);
    if (apiResult.skipped) {
      setStatus(`采集完成，${apiResult.reason}`);
    } else {
      setStatus(`采集完成，发送成功 ${apiResult.status}`);
    }
  } catch (error) {
    setStatus(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

function renderResult(result) {
  latestResult = result;
  const info = result.Product_Information || result;
  els.output.value = formatJson(result);
  els.confidence.textContent = `${result.confidence ?? 0}%`;
  els.platform.textContent = result.platform || "--";
  els.productId.textContent = info.product_id || "--";
  els.skuId.textContent = info.sku_id || "--";
  els.price.textContent = info.price?.raw || "--";
  setActionEnabled(true);
}

async function sendResultToApi(result) {
  const config = getApiConfig();
  if (!config.enabled) {
    return { skipped: true, reason: "API 未启用" };
  }
  if (!config.endpoint) {
    return { skipped: true, reason: "API 未配置" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.endpoint, {
      method: config.method || "POST",
      headers: config.headers,
      body: JSON.stringify(buildApiPayload(result, config)),
      signal: controller.signal
    });
    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
      const detail = responseText ? `：${responseText.slice(0, 120)}` : "";
      throw new Error(`采集完成，但发送失败：HTTP ${response.status}${detail}`);
    }
    return {
      skipped: false,
      status: response.status,
      responseText
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("采集完成，但发送失败：API 请求超时");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getApiConfig() {
  const custom = window.PRODUCT_COLLECTOR_API_CONFIG || {};
  return {
    ...DEFAULT_API_CONFIG,
    ...custom,
    headers: {
      ...DEFAULT_API_CONFIG.headers,
      ...(custom.headers || {})
    }
  };
}

function buildApiPayload(result, config) {
  const info = result.Product_Information || {};
  const price = info.price || {};
  return prunePayload({
    platform: result.platform || "",
    product_code: result.goods_id || info.goods_id || info.product_id || "",
    reporter: config.reporter || DEFAULT_API_CONFIG.reporter,
    product_info: {
      product_id: info.product_id || result.goods_id || "",
      title: info.full_title || info.title || "",
      shop_id: info.shop_id || "",
      shop_name: info.shop_name || "",
      price: price.amount || normalizePriceForApi(price.raw),
      currency: price.currency || "",
      price_range: price.raw || "",
      image: info.main_image_url || info.main_image || "",
      skus: buildApiSkus(info)
    }
  });
}

function buildApiSkus(info) {
  const variants = Array.isArray(info.variants) ? info.variants : [];
  const skus = variants
    .filter((variant) => variant && (variant.sku_id || variant.price || variant.stock || variant.availability || variant.spec || variant.specs?.length))
    .map((variant) => prunePayload({
      sku_id: variant.sku_id || "",
      spec_text: buildSpecText(variant),
      price: normalizePriceForApi(variant.price),
      currency: variant.currency || info.price?.currency || "",
      stock: normalizeStockForApi(variant.stock)
    }));

  if (!skus.length) {
    skus.push(...buildOptionGroupSkus(info));
  }

  if (!skus.length && info.sku_id) {
    skus.push(prunePayload({
      sku_id: info.sku_id,
      spec_text: (info.selected_specs || []).map((item) => item.value).filter(Boolean).join(" / "),
      price: info.price?.amount || normalizePriceForApi(info.price?.raw),
      currency: info.price?.currency || ""
    }));
  }
  return skus;
}

function buildOptionGroupSkus(info) {
  const groups = (Array.isArray(info.option_groups) ? info.option_groups : [])
    .map((group) => ({
      name: group.name || "option",
      options: (Array.isArray(group.options) ? group.options : [])
        .filter((option) => option && option.value && !option.disabled)
    }))
    .filter((group) => group.options.length);

  if (!groups.length) return [];

  const combinations = cartesianOptionGroups(groups).slice(0, 120);
  const selectedText = (info.selected_specs || [])
    .map((item) => item.value)
    .filter(Boolean)
    .join(" / ");
  const currentSkuAssigned = { value: false };

  return combinations.map((combo, index) => {
    const specText = combo.map((item) => item.value).filter(Boolean).join(" / ");
    const comboHasSelected = combo.some((item) => item.selected);
    const matchesSelected = selectedText && selectedText === specText;
    const shouldUseCurrentSku = info.sku_id && !currentSkuAssigned.value && (matchesSelected || comboHasSelected || (!selectedText && index === 0));
    if (shouldUseCurrentSku) currentSkuAssigned.value = true;
    return prunePayload({
      sku_id: shouldUseCurrentSku ? info.sku_id : "",
      spec_text: specText,
      price: info.price?.amount || normalizePriceForApi(info.price?.raw),
      currency: info.price?.currency || ""
    });
  });
}

function cartesianOptionGroups(groups) {
  return groups.reduce((rows, group) => {
    const next = [];
    for (const row of rows) {
      for (const option of group.options) {
        next.push([...row, option]);
      }
    }
    return next;
  }, [[]]);
}

function buildSpecText(variant) {
  const specs = Array.isArray(variant.specs) ? variant.specs : [];
  if (specs.length) return specs.map((item) => item.value).filter(Boolean).join(" / ");
  if (variant.spec?.value) return variant.spec.value;
  return "";
}

function normalizePriceForApi(value) {
  const text = String(value || "");
  const match = text.match(/[0-9][0-9.,]*/);
  return match ? match[0].replace(/,/g, "") : "";
}

function normalizeStockForApi(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const text = String(value);
  if (/^(true|soldout|outofstock)$/i.test(text)) return 0;
  if (/^(false|instock)$/i.test(text)) return undefined;
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function prunePayload(value) {
  if (Array.isArray(value)) {
    return value.map(prunePayload).filter((item) => item !== null && item !== undefined);
  }
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const pruned = prunePayload(child);
    if (pruned === null || pruned === undefined || pruned === "") continue;
    if (Array.isArray(pruned) && pruned.length === 0) continue;
    if (typeof pruned === "object" && !Array.isArray(pruned) && Object.keys(pruned).length === 0) continue;
    output[key] = pruned;
  }
  return output;
}

async function copyJson() {
  if (!latestResult) return;
  await navigator.clipboard.writeText(formatJson(latestResult));
  setStatus("JSON 已复制");
}

function downloadJson(result) {
  if (!result) return;
  const filename = buildFilename(result, "json");
  downloadText(filename, formatJson(result), "application/json;charset=utf-8");
  setStatus("JSON 已下载");
}

function formatJson(result) {
  return JSON.stringify(orderProductResult(result), null, 2);
}

function orderProductResult(result) {
  const info = result.Product_Information || {};
  const ordered = {};
  putKeys(ordered, result, ["platform", "goods_id"]);
  if (result.Product_Information) {
    ordered.Product_Information = orderObject(info, [
      "product_id",
      "goods_id",
      "item_id",
      "title",
      "full_title",
      "sku_id",
      "page_sku",
      "shop_name",
      "shop_id",
      "price",
      "spec_info",
      "selected_specs",
      "current_variant",
      "specs",
      "product_attributes",
      "option_groups",
      "main_image",
      "main_image_url",
      "images",
      "variants",
      "url",
      "page_url"
    ]);
  }
  putKeys(ordered, result, [
    "captured_at",
    "page_url",
    "host",
    "title",
    "full_title",
    "product_id",
    "sku_id",
    "page_sku",
    "shop_name",
    "shop_id",
    "price",
    "spec_info",
    "selected_specs",
    "current_variant",
    "specs",
    "product_attributes",
    "option_groups",
    "main_image",
    "main_image_url",
    "images",
    "variants",
    "confidence",
    "warnings",
    "evidence"
  ]);
  for (const key of Object.keys(result)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
      ordered[key] = orderObject(result[key]);
    }
  }
  return ordered;
}

function orderObject(value, preferredKeys = []) {
  if (Array.isArray(value)) return value.map((item) => orderObject(item));
  if (!value || typeof value !== "object") return value;

  const ordered = {};
  putKeys(ordered, value, preferredKeys.length ? preferredKeys : [
    "name",
    "value",
    "selected",
    "disabled",
    "platform_value_id",
    "raw",
    "amount",
    "currency",
    "sku_id",
    "price",
    "availability",
    "url",
    "specs"
  ]);
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
      ordered[key] = orderObject(value[key]);
    }
  }
  return ordered;
}

function putKeys(target, source, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      target[key] = orderObject(source[key]);
    }
  }
}

function downloadCsv(result) {
  if (!result) return;
  const filename = buildFilename(result, "csv");
  downloadText(filename, toCsv(result), "text/csv;charset=utf-8");
  setStatus("CSV 已下载");
}

function toCsv(result) {
  const info = result.Product_Information || result;
  const row = {
    captured_at: result.captured_at || "",
    platform: result.platform || "",
    page_url: info.page_url || result.page_url || "",
    title: info.title || "",
    full_title: info.full_title || "",
    product_id: info.product_id || "",
    goods_id: result.goods_id || info.goods_id || "",
    item_id: info.item_id || "",
    sku_id: info.sku_id || "",
    page_sku: info.page_sku || "",
    shop_name: info.shop_name || "",
    shop_id: info.shop_id || "",
    main_image: info.main_image || "",
    main_image_url: info.main_image_url || "",
    images: (info.images || []).join(" | "),
    price_raw: info.price?.raw || "",
    price_amount: info.price?.amount || "",
    currency: info.price?.currency || "",
    Product_Information: result.Product_Information ? JSON.stringify(result.Product_Information) : "",
    spec_info: info.spec_info ? JSON.stringify(info.spec_info) : "",
    selected_specs: (info.selected_specs || []).map((item) => `${item.name}:${item.value}`).join(" | "),
    specs: (info.specs || []).map((item) => `${item.name}:${item.value}`).join(" | "),
    product_attributes: (info.product_attributes || []).map((item) => `${item.name}:${item.value}`).join(" | "),
    option_groups: (info.option_groups || []).map((group) => {
      const options = (group.options || []).map((item) => {
        const flags = [item.selected ? "selected" : "", item.disabled ? "disabled" : ""].filter(Boolean).join("/");
        return flags ? `${item.value}(${flags})` : item.value;
      }).join("/");
      return `${group.name}:${options}`;
    }).join(" | "),
    current_variant: info.current_variant ? JSON.stringify(info.current_variant) : "",
    variants: (info.variants || []).map((item) => JSON.stringify(item)).join(" | "),
    warnings: (result.warnings || []).join(" | "),
    confidence: result.confidence ?? ""
  };
  const headers = Object.keys(row);
  return `${headers.join(",")}\n${headers.map((key) => csvCell(row[key])).join(",")}\n`;
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadText(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildFilename(result, ext) {
  const platform = sanitizeFilename(result.platform || "product");
  const info = result.Product_Information || result;
  const id = sanitizeFilename(result.goods_id || info.product_id || info.sku_id || "unknown");
  return `${platform}_${id}_${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function sanitizeFilename(value) {
  return String(value).replace(/[^0-9A-Za-z._-]+/g, "_").slice(0, 80);
}

function setBusy(isBusy) {
  els.collectBtn.disabled = isBusy;
  els.collectBtn.querySelector("span:last-child").textContent = isBusy ? "采集中" : "采集";
}

function setActionEnabled(enabled) {
  els.copyBtn.disabled = !enabled;
  els.jsonBtn.disabled = !enabled;
  els.csvBtn.disabled = !enabled;
}

function setStatus(text) {
  els.status.textContent = text;
}
