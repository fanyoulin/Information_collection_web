# 商品信息采集助手

这是一个 Chrome/Edge Manifest V3 插件 MVP。用户打开 SHEIN、Temu 等商品详情页后，点击插件弹窗里的“采集”，插件会读取当前页面的 DOM、meta 和页面脚本里的 JSON 片段，整理出商品标题、商品 ID、`sku_id`、规格、店铺、价格等字段。

## 安装

1. 打开 `chrome://extensions/` 或 `edge://extensions/`。
2. 打开“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录：`C:\script\Information_collection_web`。

## 分发到其它电脑

1. 把 `dist/product-info-collector.zip` 发到其它电脑。
2. 在其它电脑上解压到一个固定目录，例如 `D:\tools\product-info-collector`。
3. 打开 Chrome 的 `chrome://extensions/`。
4. 打开右上角“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择解压后的插件目录，也就是包含 `manifest.json` 的那一层目录。

注意：安装后不要删除或移动这个解压目录，否则 Chrome 下次启动时会找不到插件文件。

## 使用

1. 在浏览器打开商品详情页。
2. 点击工具栏里的“商品信息采集助手”。
3. 点击“采集”。
4. 复制 JSON，或下载 JSON/CSV。

## API 对接

API 地址确定后，修改 `src/config.js`：

```js
window.PRODUCT_COLLECTOR_API_CONFIG = {
  enabled: true,
  endpoint: "https://example.com/api/products/collect",
  method: "POST",
  timeoutMs: 15000,
  headers: {
    "Content-Type": "application/json"
  }
};
```

插件会在点击“采集”后先读取商品信息，再自动把完整 JSON 发送到 `endpoint`。当前 API 还没开发完成时，保持 `enabled: false` 即可，插件会只采集不发送。

## 当前边界

- 只在用户手动点击插件后采集当前标签页。
- API 发送逻辑已预留；正式地址确定后只需要改 `src/config.js`。
- 不做自动批量访问，不处理验证码，不绕过平台风控。
- 部分页面的 `sku_id` 需要先选择规格后才会出现在页面数据里。
- SHEIN/Temu 不同国家站页面结构可能不同，后续需要用真实样本继续补字段规则。
