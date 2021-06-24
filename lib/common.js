const cheerio = require("cheerio"); // HTML页面解析
const HTML2BBCode = require("html2bbcode").HTML2BBCode;

// 常量定义
export const AUTHOR = "Rhilip";
const VERSION = "0.6.3";

/** 公有的JSON字段，其他字段为不同生成模块的信息
 *  考虑到历史兼容的问题，应该把所有字段都放在顶层字典
 *  （虽然说最好的实践是放在 root.data 里面
 */
const default_body = {
  "success": false, // 请求是否成功，客户端应该首先检查该字段
  "error": null, // 如果请求失败，此处为失败原因
  "format": "", // 使用BBCode格式整理的简介
  "copyright": `Powered by @${AUTHOR}`, // 版权信息
  "version": VERSION, // 版本
  "generate_at": 0 // 生成时间（毫秒级时间戳），可以通过这个值与当前时间戳比较判断缓存是否应该过期
};

export const NONE_EXIST_ERROR = "The corresponding resource does not exist.";

// 解析HTML页面
export function page_parser(responseText) {
  return cheerio.load(responseText, {
    decodeEntities: false
  });
}

// 解析JSONP返回
export function jsonp_parser(responseText) {
  try {
    responseText = responseText.replace(/\n/ig, '').match(/[^(]+\((.+)\)/)[1];
    return JSON.parse(responseText);
  } catch (e) {
    return {}
  }
}

// Html2bbcode
export function html2bbcode(html) {
  let converter = new HTML2BBCode();
  let bbcode = converter.feed(html);
  return bbcode.toString();
}

// 返回Json请求
export function makeJsonResponse(body_update) {
  let body = Object.assign({},
    default_body,
    body_update, {
      generate_at: (new Date()).valueOf()
    }
  );
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*" // CORS
    }
  });
}
