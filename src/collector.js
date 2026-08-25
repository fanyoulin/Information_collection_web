(function initProductCollector(global) {
  if (!global) {
    return;
  }

  const MAX_SCRIPT_CHARS = 900000;
  const MAX_WALK_NODES = 5000;
  const MAX_TEXT_ITEMS = 80;

  function collectProduct() {
    const doc = global.document;
    const location = global.location;
    const url = location.href;
    const host = location.hostname.toLowerCase();
    const platform = detectPlatform(host);
    const scripts = collectScriptTexts(doc);
    const jsonObjects = collectJsonObjects(doc);
    const scriptText = scripts.join("\n");
    const candidates = buildCandidates(doc, url, host, scriptText, jsonObjects);
    const pageState = detectPageState(doc, url, platform);
    if (pageState.blocked) {
      const blockedProductId = firstValue([
        idFromUrl(url, platform),
        regexFirst(scriptText, productIdPatterns())
      ]);
      const blockedGoodsId = firstValue([
        queryParamValue(url, "goods_id"),
        blockedProductId,
        regexFirst(scriptText, goodsIdPatterns())
      ]);
      return pruneEmpty({
        platform,
        goods_id: blockedGoodsId,
        Product_Information: {
          product_id: blockedProductId,
          goods_id: blockedGoodsId,
          url,
          page_url: url
        },
        captured_at: new Date().toISOString(),
        page_url: url,
        host,
        confidence: blockedGoodsId ? 30 : 10,
        warnings: [pageState.warning],
        evidence: {
          json_ld_count: jsonObjects.length,
          script_count: scripts.length,
          source: "manual_page_read",
          page_state: pageState.type
        }
      });
    }
    const pageSku = firstValue([
      extractPageSkuFromDom(doc, platform),
      regexFirst(scriptText, pageSkuPatterns())
    ]);
    const selectedSpecs = normalizeSpecs(extractSelectedSpecsFromDom(doc, platform));
    const variants = normalizeVariants(candidates.variants);
    const currentVariant = findCurrentVariantByUrl(variants, url);
    const optionGroups = normalizeOptionGroups([
      ...extractOptionGroupsFromDom(doc, platform),
      ...extractOptionGroupsFromVariants(variants)
    ]);
    const images = normalizeImages([
      ...candidates.images,
      ...extractImagesFromDom(doc, platform),
      metaContent(doc, "meta[property='og:image']"),
      metaContent(doc, "meta[name='twitter:image']"),
      metaContent(doc, "meta[itemprop='image']")
    ]);
    const mainImage = firstValue([
      candidates.main_image,
      images[0]
    ]);

    const fullTitle = firstValue([
      extractFullTitleFromDom(doc, platform),
      candidates.full_title,
      cleanProductTitle(metaContent(doc, "meta[property='og:title']"), platform),
      cleanProductTitle(metaContent(doc, "meta[name='twitter:title']"), platform),
      cleanProductTitle(doc.title, platform)
    ]);

    const title = firstValue([
      fullTitle,
      metaContent(doc, "meta[property='og:title']"),
      metaContent(doc, "meta[name='twitter:title']"),
      textOf(doc, "h1"),
      cleanTitle(doc.title)
    ]);

    const price = firstValue([
      extractPriceFromDom(doc),
      metaContent(doc, "meta[property='product:price:amount']"),
      metaContent(doc, "meta[itemprop='price']"),
      candidates.price
    ]);

    const currency = firstValue([
      metaContent(doc, "meta[property='product:price:currency']"),
      candidates.currency,
      inferCurrency(price)
    ]);

    const specs = platform === "shein"
      ? normalizeSpecs(candidates.specs)
      : normalizeSpecs([
        ...candidates.specs,
        ...extractSpecsFromDom(doc)
      ]);
    const productAttributes = normalizeSpecs([
      ...extractProductAttributesFromDom(doc, platform)
    ]);
    const specInfo = pruneEmpty({
      default_specs: cloneSpecs(selectedSpecs),
      option_groups: optionGroups,
      product_attributes: productAttributes,
      variant_specs: variants,
      all_specs: normalizeSpecs([
        ...selectedSpecs,
        ...specs,
        ...optionGroups.flatMap((group) => (group.options || []).map((option) => ({
          name: group.name,
          value: option.value
        }))),
        ...productAttributes
      ])
    });

    const productId = firstValue([
      idFromUrl(url, platform),
      candidates.product_id,
      regexFirst(scriptText, productIdPatterns())
    ]);
    const goodsId = platform === "shein"
      ? firstValue([
        queryParamValue(url, "goods_id"),
        productId,
        regexFirst(scriptText, goodsIdPatterns())
      ])
      : firstValue([
        queryParamValue(url, "goods_id"),
        regexFirst(scriptText, goodsIdPatterns()),
        productId
      ]);

    const skuId = resolveSkuId(platform, url, pageSku, currentVariant, candidates, scriptText);
    const itemId = firstValue([
      extractItemIdFromDom(doc, platform),
      queryParamValue(url, "item_id"),
      candidates.item_id,
      regexFirst(scriptText, itemIdPatterns())
    ]);

    const shopName = firstValue([
      extractShopNameFromDom(doc, platform),
      candidates.shop_name,
      textOf(doc, "[data-testid*='store' i]"),
      textOf(doc, "[data-testid*='shop' i]"),
      textOf(doc, "[class*='store' i]"),
      textOf(doc, "[class*='shop' i]")
    ]);

    const shopId = firstValue([
      candidates.shop_id,
      regexFirst(url, shopIdPatterns()),
      regexFirst(scriptText, shopIdPatterns())
    ]);
    const priceInfo = buildPriceInfo(price, currency, platform);
    const productInformation = pruneEmpty({
      product_id: productId,
      goods_id: goodsId,
      item_id: itemId,
      title,
      full_title: fullTitle,
      sku_id: skuId,
      page_sku: pageSku,
      shop_name: shopName,
      shop_id: shopId,
      price: priceInfo,
      spec_info: specInfo,
      selected_specs: selectedSpecs,
      current_variant: currentVariant,
      specs,
      product_attributes: productAttributes,
      option_groups: optionGroups,
      main_image: mainImage,
      main_image_url: mainImage,
      images,
      variants,
      url,
      page_url: url
    });

    const result = {
      platform,
      goods_id: goodsId,
      Product_Information: productInformation,
      captured_at: new Date().toISOString(),
      page_url: url,
      host,
      confidence: scoreConfidence({ title, fullTitle, productId, goodsId, itemId, skuId, shopName, shopId, price, mainImage, specs, productAttributes, optionGroups, variants }),
      warnings: buildWarnings({ platform, title, fullTitle, productId, goodsId, itemId, skuId, pageSku, currentVariant, price, mainImage, specs, productAttributes, optionGroups, variants, shopId }),
      evidence: {
        json_ld_count: jsonObjects.length,
        script_count: scripts.length,
        source: "manual_page_read"
      }
    };

    return pruneEmpty(result);
  }

  function detectPlatform(host) {
    if (host.includes("temu.")) return "temu";
    if (host.includes("shein.")) return "shein";
    return "unknown";
  }

  function detectPageState(doc, url, platform) {
    if (platform !== "temu") return { blocked: false };
    const title = cleanupText(doc.title || "");
    const text = cleanupText(doc.body?.innerText || "");
    const hasProductSignals = /\bProduct detail\b/i.test(text) || /\bItem ID\b/i.test(text);
    if (/\/login\.html/i.test(url) || /^Temu\s*\|\s*Login$/i.test(title) || (!hasProductSignals && /\bAll data will be encrypted\b.*\bSign in\b/i.test(text.slice(0, 1200)))) {
      return {
        blocked: true,
        type: "temu_login",
        warning: "当前页面是 Temu 登录页，未进入商品详情，无法采集完整商品信息。"
      };
    }
    if (!hasProductSignals && (/verify|captcha|robot|challenge/i.test(url) || /All data (?:is|will be) safeguarded/i.test(text.slice(0, 1200)))) {
      return {
        blocked: true,
        type: "temu_security",
        warning: "当前页面是 Temu 安全/验证页面，未进入商品详情，无法采集完整商品信息。"
      };
    }
    return { blocked: false };
  }

  function buildCandidates(doc, url, host, scriptText, jsonObjects) {
    const found = {
      product_id: null,
      item_id: null,
      full_title: null,
      sku_id: null,
      shop_name: null,
      shop_id: null,
      price: null,
      currency: null,
      specs: [],
      variants: [],
      images: [],
      main_image: null
    };

    for (const obj of jsonObjects) {
      walkObject(obj, found);
      collectJsonLdProduct(obj, found);
    }

    found.product_id = firstValue([
      found.product_id,
      regexFirst(scriptText, productIdPatterns())
    ]);
    found.item_id = firstValue([
      found.item_id,
      regexFirst(scriptText, itemIdPatterns())
    ]);
    found.sku_id = firstValue([
      found.sku_id,
      regexFirst(scriptText, skuIdPatterns())
    ]);
    found.shop_id = firstValue([
      found.shop_id,
      regexFirst(scriptText, shopIdPatterns())
    ]);
    found.shop_name = firstValue([
      found.shop_name,
      regexFirst(scriptText, [
        /"shopName"\s*:\s*"([^"]{1,120})"/i,
        /"storeName"\s*:\s*"([^"]{1,120})"/i,
        /"sellerName"\s*:\s*"([^"]{1,120})"/i,
        /"mallName"\s*:\s*"([^"]{1,120})"/i
      ])
    ]);
    found.price = firstValue([
      found.price,
      regexFirst(scriptText, [
        /"salePrice"\s*:\s*"([^"]{1,80})"/i,
        /"retailPrice"\s*:\s*"([^"]{1,80})"/i,
        /"currentPrice"\s*:\s*"([^"]{1,80})"/i,
        /"price"\s*:\s*"([^"]{1,80})"/i
      ])
    ]);

    return found;
  }

  function collectJsonLdProduct(obj, found) {
    const products = [];
    const queue = Array.isArray(obj) ? obj.slice() : [obj];
    while (queue.length) {
      const item = queue.shift();
      if (!item || typeof item !== "object") continue;
      const type = String(item["@type"] || item.type || "").toLowerCase();
      if (type.includes("product")) products.push(item);
      for (const value of Object.values(item)) {
        if (value && typeof value === "object") {
          if (Array.isArray(value)) queue.push(...value);
          else queue.push(value);
        }
      }
    }

    const hasProductGroup = products.some((product) => String(product["@type"] || product.type || "").toLowerCase().includes("productgroup"));
    for (const product of products) {
      const variants = Array.isArray(product.hasVariant) ? product.hasVariant : [];
      for (const variant of variants) {
        const normalized = jsonLdVariantFromProduct(variant);
        if (normalized) found.variants.push(normalized);
      }

      found.full_title = firstValue([found.full_title, pick(product, ["name", "headline", "title"])]);
      found.product_id = firstValue([found.product_id, pick(product, ["productID", "productId", "goodsId"])]);
      found.item_id = firstValue([found.item_id, pick(product, ["itemId", "item_id"])]);
      if (!hasProductGroup) {
        found.sku_id = firstValue([found.sku_id, pick(product, ["sku", "skuId", "sku_id"])]);
      }
      found.price = firstValue([found.price, pick(product.offers || {}, ["price", "lowPrice", "highPrice"])]);
      found.currency = firstValue([found.currency, pick(product.offers || {}, ["priceCurrency", "currency"])]);
      found.images.push(...normalizeImages([product.image]));
      found.main_image = firstValue([found.main_image, found.images[0]]);
      const seller = product.seller || product.brand || {};
      found.shop_name = firstValue([found.shop_name, pick(seller, ["name", "storeName", "shopName"])]);
    }
  }

  function jsonLdVariantFromProduct(product) {
    if (!product || typeof product !== "object") return null;
    const specs = [];
    if (Array.isArray(product.additionalProperty)) {
      for (const property of product.additionalProperty) {
        const spec = specFromObject(property);
        if (spec) specs.push(spec);
      }
    }
    if (product.color) specs.push({ name: "Color", value: normalizeScalar(product.color) });

    const offers = product.offers || {};
    return pruneEmpty({
      sku_id: pick(product, ["sku", "skuId", "sku_id"]),
      price: pick(offers, ["price", "lowPrice", "highPrice"]),
      currency: pick(offers, ["priceCurrency", "currency"]),
      availability: simplifyAvailability(pick(offers, ["availability"])),
      url: normalizeScalar(offers.url),
      specs: normalizeSpecs(specs)
    });
  }

  function walkObject(root, found) {
    let walked = 0;
    const stack = [{ value: root, depth: 0, parentKey: "" }];
    while (stack.length && walked < MAX_WALK_NODES) {
      const current = stack.pop();
      const value = current.value;
      walked += 1;

      if (!value || typeof value !== "object" || current.depth > 8) {
        continue;
      }

      if (!Array.isArray(value)) {
        consumeCandidateObject(value, found, current.parentKey);
      }

      if (Array.isArray(value)) {
        if (looksLikeSpecArray(current.parentKey, value)) {
          found.specs.push(...extractSpecsFromArray(value));
          found.variants.push(...extractVariantsFromArray(value));
        }
        for (let i = value.length - 1; i >= 0; i -= 1) {
          stack.push({ value: value[i], depth: current.depth + 1, parentKey: current.parentKey });
        }
      } else {
        for (const [key, child] of Object.entries(value)) {
          if (child && typeof child === "object") {
            stack.push({ value: child, depth: current.depth + 1, parentKey: key });
          }
        }
      }
    }
  }

  function consumeCandidateObject(obj, found, parentKey) {
    found.full_title = firstValue([found.full_title, pick(obj, [
      "goods_name", "goodsName", "product_name", "productName", "title", "name"
    ])]);
    found.product_id = firstValue([found.product_id, pick(obj, [
      "goods_id", "goodsId", "product_id", "productId", "productID", "goodsSn", "goods_sn"
    ])]);
    found.item_id = firstValue([found.item_id, pick(obj, [
      "item_id", "itemId", "itemID"
    ])]);
    found.sku_id = firstValue([found.sku_id, pick(obj, [
      "sku_id", "skuId", "skc", "skuCode", "sku_code", "sku", "mallSkuId"
    ])]);
    found.shop_id = firstValue([found.shop_id, pick(obj, [
      "shop_id", "shopId", "store_id", "storeId", "store_code", "storeCode", "seller_id", "sellerId", "mall_id", "mallId", "supplier_id", "supplierId"
    ])]);
    found.shop_name = firstValue([found.shop_name, pick(obj, [
      "shop_name", "shopName", "store_name", "storeName", "seller_name", "sellerName", "mall_name", "mallName", "supplier_name", "supplierName"
    ])]);
    found.price = firstValue([found.price, pick(obj, [
      "salePrice", "retailPrice", "currentPrice", "price", "amount", "priceAmount", "minPrice", "maxPrice"
    ])]);
    found.currency = firstValue([found.currency, pick(obj, [
      "currency", "priceCurrency", "currencyCode", "currency_code"
    ])]);
    found.images.push(...normalizeImages([
      obj.image,
      obj.images,
      obj.goods_img,
      obj.goodsImg,
      obj.goodsImage,
      obj.goodsImageUrl,
      obj.main_img,
      obj.mainImg,
      obj.mainImage,
      obj.mainImageUrl,
      obj.original_img,
      obj.originalImg,
      obj.thumbUrl,
      obj.hdThumbUrl,
      obj.thumbnail,
      obj.thumbnailUrl
    ]));
    found.main_image = firstValue([found.main_image, found.images[0]]);

    if (looksLikeSpecObject(obj, parentKey)) {
      const spec = specFromObject(obj);
      if (spec) found.specs.push(spec);
      const variant = variantFromObject(obj);
      if (variant) found.variants.push(variant);
    }
  }

  function pick(obj, keys) {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const normalized = normalizeScalar(obj[key]);
        if (normalized) return normalized;
      }
    }
    return null;
  }

  function collectJsonObjects(doc) {
    const objects = [];
    const scripts = Array.from(doc.scripts || []);
    for (const script of scripts) {
      const type = (script.type || "").toLowerCase();
      const text = script.textContent || "";
      if (!text.trim()) continue;

      if (type.includes("json")) {
        const parsed = parseJson(text);
        if (parsed) objects.push(parsed);
        continue;
      }

      for (const jsonText of extractAssignedJson(text)) {
        const parsed = parseJson(jsonText);
        if (parsed) objects.push(parsed);
      }
    }
    return objects;
  }

  function collectScriptTexts(doc) {
    const texts = [];
    let total = 0;
    for (const script of Array.from(doc.scripts || [])) {
      const text = script.textContent || "";
      if (!text.trim()) continue;
      const slice = text.slice(0, Math.max(0, MAX_SCRIPT_CHARS - total));
      if (!slice) break;
      texts.push(slice);
      total += slice.length;
      if (total >= MAX_SCRIPT_CHARS) break;
    }
    return texts;
  }

  function extractAssignedJson(text) {
    const results = [];
    const markers = [
      "__NEXT_DATA__",
      "__INITIAL_STATE__",
      "__INITIAL_DATA__",
      "__NUXT__",
      "window.gbRawData",
      "window.productIntroData",
      "window.goodsDetail",
      "window.__PRODUCT_DETAIL__"
    ];

    for (const marker of markers) {
      const index = text.indexOf(marker);
      if (index === -1) continue;
      const objectStart = findFirstJsonStart(text, index);
      if (objectStart === -1) continue;
      const jsonText = readBalancedJson(text, objectStart);
      if (jsonText) results.push(jsonText);
    }

    return results;
  }

  function findFirstJsonStart(text, startIndex) {
    const brace = text.indexOf("{", startIndex);
    const bracket = text.indexOf("[", startIndex);
    if (brace === -1) return bracket;
    if (bracket === -1) return brace;
    return Math.min(brace, bracket);
  }

  function readBalancedJson(text, startIndex) {
    const open = text[startIndex];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIndex; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth += 1;
      if (ch === close) depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
    return null;
  }

  function parseJson(text) {
    try {
      return JSON.parse(text.trim());
    } catch (_) {
      return null;
    }
  }

  function idFromUrl(url, platform) {
    const text = decodeUriSafe(url);
    const patterns = platform === "temu"
      ? [
        /[?&](?:goods_id|product_id)=([0-9A-Za-z_-]+)/i,
        /-g-([0-9A-Za-z_-]+)\.html/i,
        /\/g-([0-9A-Za-z_-]+)/i
      ]
      : [
        /[?&](?:goods_id|product_id)=([0-9A-Za-z_-]+)/i,
        /-p-([0-9A-Za-z_-]+)\.html/i,
        /\/p-([0-9A-Za-z_-]+)/i
      ];
    return regexFirst(text, patterns);
  }

  function productIdPatterns() {
    return [
      /"(?:goods_id|goodsId|product_id|productId|productID)"\s*:\s*"?([0-9A-Za-z_-]{5,})"?/i,
      /(?:goods_id|product_id)=([0-9A-Za-z_-]{5,})/i
    ];
  }

  function itemIdPatterns() {
    return [
      /Item\s*ID\s*[:：]?\s*([0-9A-Za-z_-]{3,})/i,
      /商品(?:编号|ID|Id|id)\s*[:：]?\s*([0-9A-Za-z_-]{3,})/i,
      /"(?:item_id|itemId|itemID)"\s*:\s*"?([0-9A-Za-z_-]{3,})"?/i,
      /(?:item_id|itemId)=([0-9A-Za-z_-]{3,})/i
    ];
  }

  function goodsIdPatterns() {
    return [
      /"(?:goods_id|goodsId)"\s*:\s*"?([0-9A-Za-z_-]{5,})"?/i,
      /(?:goods_id|goodsId)=([0-9A-Za-z_-]{5,})/i
    ];
  }

  function skuIdPatterns() {
    return [
      /(?:skucode|sku_id|skuId|skuCode|sku_code)=([0-9A-Za-z_-]{3,})/i,
      /"(?:sku_id|skuId|skuCode|sku_code|mallSkuId|skc|sku)"\s*:\s*"?([0-9A-Za-z_-]{3,})"?/i
    ];
  }

  function resolveSkuId(platform, url, pageSku, currentVariant, candidates, scriptText) {
    const urlSku = regexFirst(url, skuIdPatterns());
    if (platform === "shein") {
      return firstValue([urlSku, pageSku]);
    }
    return firstValue([
      urlSku,
      currentVariant?.sku_id,
      pageSku,
      candidates.sku_id,
      regexFirst(scriptText, skuIdPatterns())
    ]);
  }

  function pageSkuPatterns() {
    return [
      /SKU\s*[:：]\s*([0-9A-Za-z_-]{5,})/i,
      /"goods_sn"\s*:\s*"([^"]{5,80})"/i,
      /"goodsSn"\s*:\s*"([^"]{5,80})"/i
    ];
  }

  function shopIdPatterns() {
    return [
      /"(?:shop_id|shopId|store_id|storeId|store_code|storeCode|seller_id|sellerId|mall_id|mallId|supplier_id|supplierId)"\s*:\s*"?([0-9A-Za-z_-]{3,})"?/i,
      /(?:shop_id|shopId|store_id|storeId|store_code|storeCode|seller_id|sellerId|mall_id|mallId)=([0-9A-Za-z_-]{3,})/i
    ];
  }

  function regexFirst(text, patterns) {
    if (!text) return null;
    for (const pattern of patterns) {
      const match = String(text).match(pattern);
      if (match && match[1]) return cleanupText(match[1]);
    }
    return null;
  }

  function queryParamValue(url, name) {
    try {
      const parsed = new URL(url);
      return cleanupText(parsed.searchParams.get(name) || "");
    } catch (_) {
      return null;
    }
  }

  function metaContent(doc, selector) {
    return cleanupText(doc.querySelector(selector)?.getAttribute("content") || "");
  }

  function textOf(doc, selector) {
    const elements = Array.from(doc.querySelectorAll(selector)).slice(0, 6);
    for (const el of elements) {
      const text = visibleText(el);
      if (text && text.length <= 160) return text;
    }
    return null;
  }

  function extractFullTitleFromDom(doc, platform) {
    const selectors = platform === "shein"
      ? [
        ".product-intro__head-name h1",
        ".product-intro__head-name",
        ".product-intro__head h1",
        "h1"
      ]
      : [
        "[data-testid*='title' i]",
        "[class*='title' i]",
        "h1"
      ];
    for (const selector of selectors) {
      for (const el of Array.from(doc.querySelectorAll(selector)).slice(0, 12)) {
        const text = visibleText(el);
        if (text && text.length >= 8) return cleanProductTitle(text, platform);
      }
    }
    return null;
  }

  function cleanProductTitle(text, platform) {
    let output = cleanupText(text);
    if (!output) return null;
    if (platform === "shein") {
      output = output.replace(/\s*\|\s*SHEIN.*$/i, "");
    }
    if (platform === "temu") {
      output = output.replace(/\s*-\s*Temu.*$/i, "");
    }
    return cleanupText(output);
  }

  function extractPageSkuFromDom(doc, platform) {
    const selectors = platform === "shein"
      ? [
        ".product-intro__head-sku-text",
        ".product-intro__head-sku",
        "[class*='head-sku' i]"
      ]
      : [
        "[class*='sku' i]",
        "[data-testid*='sku' i]"
      ];
    for (const selector of selectors) {
      for (const el of Array.from(doc.querySelectorAll(selector)).slice(0, 20)) {
        const text = visibleText(el);
        const sku = text && text.match(/SKU\s*[:：]\s*([0-9A-Za-z_-]{5,})/i);
        if (sku && sku[1]) return cleanupText(sku[1]);
      }
    }
    return null;
  }

  function extractShopNameFromDom(doc, platform) {
    if (platform === "shein") {
      const sourced = Array.from(doc.querySelectorAll(".soldbybox-header__title-text"))
        .map((el) => visibleText(el))
        .filter(Boolean);
      const afterSourcedFrom = sourced.find((text, index) => index > 0 && /^sourced from$/i.test(sourced[index - 1]));
      if (afterSourcedFrom) return afterSourcedFrom;

      const soldBy = sourced.map((text) => text.match(/^Sold\s+by\s+(.+)$/i)?.[1]).find(Boolean);
      if (soldBy) return cleanupText(soldBy);

      const colorGreen = textOf(doc, ".soldbybox-header .color-green");
      const match = colorGreen && colorGreen.match(/Sourced\s*from\s*(.+)$/i);
      if (match && match[1]) return cleanupText(match[1]);

      const soldByHeader = textOf(doc, ".soldbybox-header");
      const soldByMatch = soldByHeader && soldByHeader.match(/Sold\s+by\s+(.+?)(?:\s+Ships\s+from|\s*$)/i);
      if (soldByMatch && soldByMatch[1]) return cleanupText(soldByMatch[1]);
    }

    return null;
  }

  function extractSelectedSpecsFromDom(doc, platform) {
    const specs = [];
    if (platform === "shein") {
      for (const el of Array.from(doc.querySelectorAll(".main-sales-attr__fold")).slice(0, 20)) {
        const spec = parseSpecText(visibleText(el));
        if (spec) specs.push(spec);
      }

      for (const el of Array.from(doc.querySelectorAll("[role='radio'][aria-checked='true']")).slice(0, 40)) {
        const value = cleanupText(el.getAttribute("data-attr_value_name") || el.getAttribute("aria-label") || visibleText(el));
        if (!value) continue;
        if (specs.some((spec) => equalsLoose(spec.value, value))) continue;
        const group = el.closest("[role='radiogroup']");
        const name = cleanupText(inferSpecNameFromAncestor(el) || group?.getAttribute("aria-label") || "option");
        specs.push({ name, value });
      }
    }

    return specs;
  }

  function extractOptionGroupsFromDom(doc, platform) {
    const groups = [];
    if (platform === "shein") {
      for (const group of Array.from(doc.querySelectorAll("[role='radiogroup']")).slice(0, 20)) {
        const name = cleanupText(inferSpecNameFromGroup(group) || group.getAttribute("aria-label") || "option");
        const options = Array.from(group.querySelectorAll("[role='radio']")).map((el) => {
          return pruneEmpty({
            value: cleanupText(el.getAttribute("data-attr_value_name") || el.getAttribute("aria-label") || visibleText(el)),
            selected: el.getAttribute("aria-checked") === "true" || /\bactive\b/i.test(el.className || ""),
            disabled: el.getAttribute("aria-disabled") === "true" || /soldout|disabled/i.test(el.className || ""),
            platform_value_id: cleanupText(el.getAttribute("data-size-radio") || "")
          });
        }).filter((option) => option.value);
        if (options.length) groups.push({ name, options });
      }
    }
    if (platform === "temu") {
      const options = Array.from(doc.querySelectorAll("[role='radio']")).map((el) => {
        const value = cleanupText(el.getAttribute("aria-label") || visibleText(el));
        if (!value || /select all|tick button|全选/i.test(value)) return null;
        return pruneEmpty({
          value,
          selected: el.getAttribute("aria-checked") === "true" || /selected|active|checked/i.test(el.className || ""),
          disabled: el.getAttribute("aria-disabled") === "true" || /soldout|disabled/i.test(el.className || "")
        });
      }).filter(Boolean);
      if (options.length) {
        groups.push({ name: "Specification", options });
      }
    }
    return groups;
  }

  function extractOptionGroupsFromVariants(variants) {
    const groups = new Map();
    for (const variant of variants || []) {
      const specs = variant.specs || (variant.spec ? [variant.spec] : []);
      for (const spec of specs) {
        const name = cleanupText(spec.name || "option");
        const value = cleanupText(spec.value);
        if (!value) continue;
        if (!groups.has(name)) groups.set(name, new Map());
        const values = groups.get(name);
        const existing = values.get(value) || {};
        values.set(value, pruneEmpty({
          ...existing,
          value,
          sku_id: existing.sku_id || variant.sku_id,
          price: existing.price || variant.price,
          currency: existing.currency || variant.currency,
          availability: existing.availability || variant.availability
        }));
      }
    }
    return Array.from(groups.entries()).map(([name, values]) => ({ name, options: Array.from(values.values()) }));
  }

  function normalizeOptionGroups(groups) {
    const byName = new Map();
    for (const group of groups || []) {
      const name = cleanupText(group.name || "option");
      if (!name || !Array.isArray(group.options)) continue;
      if (!byName.has(name)) byName.set(name, new Map());
      const options = byName.get(name);
      for (const option of group.options) {
        const value = cleanSpecValue(option.value);
        if (!value) continue;
        const existing = options.get(value) || {};
        options.set(value, pruneEmpty({
          ...existing,
          ...option,
          value,
          selected: Boolean(existing.selected || option.selected),
          disabled: Boolean(existing.disabled || option.disabled)
        }));
      }
    }

    return Array.from(byName.entries()).map(([name, options]) => ({
      name,
      options: Array.from(options.values())
    })).filter((group) => group.options.length);
  }

  function inferSpecNameFromAncestor(el) {
    const container = el.closest(".main-sales-attr__fold, .product-intro__bsSize, .size-item");
    if (!container) return null;
    const title = container.querySelector(".color-block, .title, .size-item__title, h2");
    return cleanSpecName(title?.innerText || title?.textContent || "");
  }

  function inferSpecNameFromGroup(group) {
    const container = group.closest(".main-sales-attr__fold, .product-intro__bsSize, .size-item");
    const title = container?.querySelector(".color-block, .title, .size-item__title, h2");
    return cleanSpecName(title?.innerText || title?.textContent || "");
  }

  function cleanSpecName(text) {
    return cleanupText(String(text || "").replace(/[:：].*$/, ""));
  }

  function cleanSpecValue(text) {
    return cleanupText(String(text || "")
      .replace(/\s+(?:Large|Small)\s+Image$/i, "")
      .replace(/\s+Image$/i, ""));
  }

  function extractImagesFromDom(doc, platform) {
    const images = [];
    const selectors = platform === "shein"
      ? [
        ".product-intro__thumbs img",
        ".product-intro__gallery img",
        ".product-intro__main img",
        ".goods-detail img"
      ]
      : platform === "temu"
        ? [
          "img[aria-label='Goods Image']",
          "img[alt*='item picture' i]",
          "img[alt][src*='img.kwcdn.com']",
          "img[src*='img.kwcdn.com']",
          "img[data-src*='img.kwcdn.com']"
        ]
      : [
        "[class*='product' i] img",
        "[class*='gallery' i] img",
        "main img"
      ];

    for (const selector of selectors) {
      for (const img of Array.from(doc.querySelectorAll(selector)).slice(0, 80)) {
        images.push(
          img.currentSrc,
          img.src,
          img.getAttribute("data-src"),
          img.getAttribute("data-original-src"),
          img.getAttribute("data-lazy"),
          img.getAttribute("data-original"),
          img.getAttribute("data-lazy-src")
        );
      }
      if (images.length) break;
    }

    return images;
  }

  function extractPriceFromDom(doc) {
    const selectors = [
      "[data-testid*='price' i]",
      "[class*='price' i]",
      "[aria-label*='price' i]",
      "[itemprop='price']"
    ];
    const priceRegex = /(?:US\$|\$|€|£|¥|￥|CA\$|AU\$|MX\$|R\$|AED|SAR|USD|EUR|GBP|JPY|CAD|AUD|MXN)\s?[0-9][0-9.,]*/i;

    for (const selector of selectors) {
      for (const el of Array.from(doc.querySelectorAll(selector)).slice(0, MAX_TEXT_ITEMS)) {
        const text = visibleText(el) || cleanupText(el.getAttribute("content") || el.getAttribute("aria-label") || "");
        const match = text.match(priceRegex);
        if (match) return cleanupText(match[0]);
      }
    }
    return null;
  }

  function extractSpecsFromDom(doc) {
    const specs = [];
    const selectors = [
      "[class*='sku' i]",
      "[class*='spec' i]",
      "[class*='attr' i]",
      "[class*='variant' i]",
      "[class*='color' i]",
      "[class*='size' i]",
      "[data-testid*='sku' i]",
      "[data-testid*='variant' i]"
    ];

    const seen = new Set();
    for (const selector of selectors) {
      for (const el of Array.from(doc.querySelectorAll(selector)).slice(0, MAX_TEXT_ITEMS)) {
        const text = visibleText(el);
        if (!text || text.length > 160 || seen.has(text)) continue;
        seen.add(text);
        const parsed = parseSpecText(text);
        if (parsed) specs.push(parsed);
      }
    }
    return specs;
  }

  function extractProductAttributesFromDom(doc, platform) {
    const attrs = [];
    if (platform === "shein") {
      for (const el of Array.from(doc.querySelectorAll(".product-meta, [aria-label='Description'], [class*='product-meta' i]")).slice(0, 20)) {
        const text = visibleText(el);
        const description = extractBetween(text, /Description\s*/i, /\s+(?:Size\s*&\s*Fit|About\s+Store|All\s+Items|Follow)\b/i);
        if (description) {
          attrs.push({ name: "Description", value: description });
          for (const value of description.split(/[,，]/).map(cleanupText).filter(Boolean)) {
            if (value.length <= 80) attrs.push({ name: "Description Item", value });
          }
        }
      }
    }
    if (platform === "temu") {
      const text = cleanupText(doc.body?.innerText || "");
      const itemId = regexFirst(text, itemIdPatterns());
      if (itemId) attrs.push({ name: "Item ID", value: itemId });

      const detailText = extractBetween(text, /Product\s+detail\s*/i, /\s+(?:Store\s+Information|Save|Report\s+issue|See\s+all\s+detail)\b/i);
      if (detailText) {
        for (const pair of extractAdjacentPairs(detailText)) {
          attrs.push(pair);
        }
      }
    }

    return attrs;
  }

  function extractItemIdFromDom(doc, platform) {
    if (platform !== "temu") return null;
    const text = cleanupText(doc.body?.innerText || "");
    return regexFirst(text, itemIdPatterns());
  }

  function extractAdjacentPairs(text) {
    const parts = cleanupText(text).split(/\s+/).filter(Boolean);
    const attrs = [];
    const knownNames = [
      "Shelf Life",
      "Allergen Information",
      "Item ID"
    ];
    for (const name of knownNames) {
      const pattern = new RegExp(`${escapeRegex(name)}\\s+(.+?)(?=\\s+(?:${knownNames.map(escapeRegex).join("|")})\\s+|$)`, "i");
      const match = cleanupText(text).match(pattern);
      if (match && match[1]) {
        const value = cleanupText(match[1].replace(/\s+Copy$/i, ""));
        if (value && value.length <= 240) attrs.push({ name, value });
      }
    }
    return attrs.length ? attrs : parts.length ? [] : [];
  }

  function extractBetween(text, startPattern, endPattern) {
    const cleaned = cleanupText(text);
    if (!cleaned) return null;
    const start = cleaned.match(startPattern);
    if (!start) return null;
    const afterStart = cleaned.slice((start.index || 0) + start[0].length);
    const end = afterStart.match(endPattern);
    const value = cleanupText(end ? afterStart.slice(0, end.index) : afterStart);
    return value && value.length <= 500 ? value : null;
  }

  function parseSpecText(text) {
    const cleaned = cleanupText(text);
    if (!cleaned || cleaned.length < 2) return null;
    const parts = cleaned.split(/[:：]/).map((part) => cleanupText(part)).filter(Boolean);
    if (parts.length >= 2 && parts[0].length <= 40 && parts[1].length <= 100) {
      return { name: parts[0], value: parts.slice(1).join(": ") };
    }
    if (/^(color|size|style|quantity|颜色|尺码|尺寸|规格|款式)/i.test(cleaned)) {
      return { name: "option", value: cleaned };
    }
    return null;
  }

  function looksLikeSpecArray(key, value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 300) return false;
    return /(sku|spec|attr|variant|color|size|goods)/i.test(key || "");
  }

  function looksLikeSpecObject(obj, parentKey) {
    const keys = Object.keys(obj).join("|");
    return /(sku|spec|attr|variant|color|size|goods)/i.test(`${parentKey}|${keys}`);
  }

  function extractSpecsFromArray(items) {
    const specs = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const spec = specFromObject(item);
      if (spec) specs.push(spec);
      for (const value of Object.values(item)) {
        if (Array.isArray(value)) specs.push(...extractSpecsFromArray(value));
      }
    }
    return specs;
  }

  function extractVariantsFromArray(items) {
    const variants = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const variant = variantFromObject(item);
      if (variant) variants.push(variant);
    }
    return variants;
  }

  function specFromObject(obj) {
    const name = pick(obj, [
      "attrName", "attributeName", "specName", "propertyName", "name", "key", "title", "label", "goodsAttrName"
    ]);
    const value = pick(obj, [
      "attrValue", "attrValueName", "attributeValue", "specValue", "propertyValue", "propertyValueName", "value", "valueName", "label", "goodsAttrValueName"
    ]);
    if (!value) return null;
    return {
      name: name || "option",
      value
    };
  }

  function variantFromObject(obj) {
    const sku = pick(obj, ["sku_id", "skuId", "skuCode", "sku_code", "sku", "mallSkuId", "skc"]);
    const price = pick(obj, ["salePrice", "retailPrice", "currentPrice", "price", "amount"]);
    const stock = pick(obj, ["stock", "stockQuantity", "quantity", "inventory", "isSoldOut", "soldOut"]);
    const spec = specFromObject(obj);
    if (!sku && !price && !stock && !spec) return null;
    return pruneEmpty({
      sku_id: sku,
      price,
      stock,
      spec
    });
  }

  function normalizeSpecs(specs) {
    const seen = new Set();
    const output = [];
    for (const spec of specs) {
      if (!spec || typeof spec !== "object") continue;
      const name = cleanupText(spec.name || "option");
      const value = cleanSpecValue(spec.value || "");
      if (!value || value.length > 160) continue;
      const key = `${name}:${value}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ name, value });
      if (output.length >= 80) break;
    }
    return output;
  }

  function cloneSpecs(specs) {
    return (specs || []).map((spec) => ({
      name: cleanupText(spec.name || "option"),
      value: cleanSpecValue(spec.value || "")
    })).filter((spec) => spec.value);
  }

  function normalizeVariants(variants) {
    const seen = new Set();
    const bySku = new Map();
    const output = [];
    for (const variant of variants) {
      if (!variant || typeof variant !== "object") continue;
      const normalized = pruneEmpty(variant);
      if (!normalized.sku_id && !normalized.price && !normalized.spec && !(normalized.specs && normalized.specs.length)) continue;
      if (normalized.sku_id && bySku.has(normalized.sku_id)) {
        const index = bySku.get(normalized.sku_id);
        if (variantQuality(normalized) > variantQuality(output[index])) {
          output[index] = normalized;
        }
        continue;
      }
      const key = JSON.stringify(normalized).slice(0, 300);
      if (seen.has(key)) continue;
      seen.add(key);
      if (normalized.sku_id) bySku.set(normalized.sku_id, output.length);
      output.push(normalized);
      if (output.length >= 120) break;
    }
    return output;
  }

  function variantQuality(variant) {
    let score = 0;
    if (variant.sku_id) score += 2;
    if (variant.price) score += 1;
    if (variant.currency) score += 1;
    if (variant.availability) score += 1;
    if (variant.spec) score += 2;
    if (variant.specs?.length) score += 3 + variant.specs.length;
    return score;
  }

  function normalizeImages(values) {
    const seen = new Set();
    const output = [];
    const stack = Array.isArray(values) ? values.slice() : [values];
    while (stack.length && output.length < 60) {
      const value = stack.shift();
      if (!value) continue;
      if (Array.isArray(value)) {
        stack.push(...value);
        continue;
      }
      if (typeof value === "object") {
        stack.push(...Object.values(value));
        continue;
      }
      const url = normalizeImageUrl(value);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      output.push(url);
    }
    return output;
  }

  function normalizeImageUrl(value) {
    const url = cleanupText(value);
    if (!url || !/^https?:\/\//i.test(url)) return null;
    if (!/\.(?:jpg|jpeg|png|webp|avif)(?:[?#].*)?$/i.test(url) && !/img\./i.test(url)) return null;
    return url;
  }

  function findCurrentVariantByUrl(variants, url) {
    const normalizedVariants = normalizeVariants(variants);
    const urlSku = regexFirst(url, skuIdPatterns());
    if (urlSku) {
      const hit = normalizedVariants.find((variant) => equalsLoose(variant.sku_id, urlSku));
      if (hit) return hit;
    }
    return null;
  }

  function equalsLoose(left, right) {
    return cleanupText(left).toLowerCase() === cleanupText(right).toLowerCase();
  }

  function firstValue(values) {
    for (const value of values) {
      const normalized = normalizeScalar(value);
      if (normalized) return normalized;
    }
    return null;
  }

  function normalizeScalar(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "string") return cleanupText(value);
    if (typeof value === "object") {
      if (typeof value.amount === "string" || typeof value.amount === "number") return cleanupText(String(value.amount));
      if (typeof value.price === "string" || typeof value.price === "number") return cleanupText(String(value.price));
      if (typeof value.name === "string") return cleanupText(value.name);
    }
    return null;
  }

  function visibleText(el) {
    if (!el) return null;
    const style = global.getComputedStyle ? global.getComputedStyle(el) : null;
    if (style && (style.display === "none" || style.visibility === "hidden")) return null;
    return cleanupText(el.innerText || el.textContent || "");
  }

  function cleanupText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\\u002F/g, "/")
      .replace(/&amp;/g, "&")
      .trim();
  }

  function cleanTitle(text) {
    return cleanupText(String(text || "").replace(/\s+\|\s+.*$/, "").replace(/\s+-\s+SHEIN.*$/i, ""));
  }

  function inferCurrency(price) {
    if (!price) return null;
    if (/US\$|USD|\$/i.test(price)) return "USD";
    if (/€|EUR/i.test(price)) return "EUR";
    if (/£|GBP/i.test(price)) return "GBP";
    if (/￥|¥|JPY/i.test(price)) return "JPY";
    if (/CA\$|CAD/i.test(price)) return "CAD";
    if (/AU\$|AUD/i.test(price)) return "AUD";
    if (/MX\$|MXN/i.test(price)) return "MXN";
    return null;
  }

  function simplifyAvailability(value) {
    const text = cleanupText(value);
    if (!text) return null;
    if (/instock$/i.test(text) || /InStock/i.test(text)) return "InStock";
    if (/outofstock$/i.test(text) || /OutOfStock/i.test(text)) return "OutOfStock";
    return text;
  }

  function normalizePriceAmount(price) {
    const match = String(price || "").match(/[0-9][0-9.,]*/);
    return match ? match[0] : null;
  }

  function buildPriceInfo(price, currency, platform) {
    if (!price) return null;
    let raw = cleanupText(price);
    let amount = normalizePriceAmount(raw);
    if (!amount) return null;
    let priceCurrency = currency || inferCurrency(raw) || (platform === "temu" ? "USD" : null);
    if (platform === "temu" && amount && /^\d{3,}$/.test(amount) && !/[.$€£¥￥]/.test(raw)) {
      amount = (Number(amount) / 100).toFixed(2);
      raw = priceCurrency === "USD" || !priceCurrency ? `$${amount}` : amount;
    }
    return pruneEmpty({ raw, amount, currency: priceCurrency });
  }

  function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function decodeUriSafe(text) {
    try {
      return decodeURIComponent(String(text || ""));
    } catch (_) {
      return String(text || "");
    }
  }

  function pruneEmpty(value) {
    if (Array.isArray(value)) {
      return value.map(pruneEmpty).filter((item) => item !== null && item !== undefined);
    }
    if (!value || typeof value !== "object") return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      const pruned = pruneEmpty(child);
      if (pruned === null || pruned === undefined || pruned === "") continue;
      if (Array.isArray(pruned) && pruned.length === 0) continue;
      if (typeof pruned === "object" && !Array.isArray(pruned) && Object.keys(pruned).length === 0) continue;
      output[key] = pruned;
    }
    return output;
  }

  function scoreConfidence(data) {
    let score = 0;
    if (data.fullTitle || data.title) score += 20;
    if (data.productId) score += 20;
    if (data.goodsId && !data.productId) score += 15;
    if (data.skuId) score += 15;
    if (data.price) score += 20;
    if (data.shopName) score += 10;
    if (data.shopId) score += 5;
    if (data.mainImage) score += 5;
    if (data.specs && data.specs.length) score += 5;
    if (data.productAttributes && data.productAttributes.length) score += 3;
    if (data.optionGroups && data.optionGroups.length) score += 5;
    if (data.variants && data.variants.length) score += 5;
    return Math.min(score, 100);
  }

  function buildWarnings(data) {
    const warnings = [];
    if (data.platform === "unknown") warnings.push("当前域名不是已识别的 SHEIN/Temu，结果可能不完整。");
    if (!data.fullTitle && !data.title) warnings.push("未识别到商品完整标题。");
    if (!data.productId) warnings.push("未识别到商品 ID。");
    if (!data.goodsId) warnings.push("未识别到 goods_id。");
    if (!data.skuId) warnings.push("未识别到 sku_id；部分站点需要先选择规格后才会出现。");
    if (!data.shopId) warnings.push("未识别到店铺 ID。");
    if (!data.mainImage) warnings.push("未识别到商品首图。");
    if (data.pageSku && data.optionGroups && data.optionGroups.length) {
      warnings.push("sku_id 按当前 URL/页面 SKU 固定，其他页面内规格已完整收集为 option_groups。");
    }
    if (!data.price) warnings.push("未识别到价格。");
    if (!(data.specs?.length || data.productAttributes?.length || data.optionGroups?.length)) {
      warnings.push("未识别到规格信息；可尝试先展开/选择商品规格后再采集。");
    }
    return warnings;
  }

  global.__productCollectorCollect = collectProduct;
})(typeof window !== "undefined" ? window : globalThis);
