import {NONE_EXIST_ERROR} from "./common";

export async function gen_epic(sid) {
  let data = {
    site: "epic",
    sid: sid
  };

  let epic_api_resp = await fetch(`https://store-content.ak.epicgames.com/api/zh-CN/content/products/${sid}`);
  if (epic_api_resp.status === 404) { // 当接口返回404时内容不存在，200则继续解析
    return Object.assign(data, {
      error: NONE_EXIST_ERROR
    });
  }

  let epic_api_json = await epic_api_resp.json();

  // 从顶层字典中获得page
  let page = epic_api_json["pages"][0];

  data["name"] = page["productName"]; // 游戏名称
  data["epic_link"] = `https://www.epicgames.com/store/zh-CN/product/${sid}/home`; // 商店链接

  data["desc"] = page["data"]["about"]["description"]; // 游戏简介
  data["poster"] = data["logo"] = page["data"]["hero"]["logoImage"]["src"]; // 游戏logo
  data["screenshot"] = (page["data"]["gallery"]["galleryImages"] || []).map(x => x["src"]); // 游戏截图

  let requirements = page["data"]["requirements"] || [];

  // 语言
  let languages = [];
  for (let i = 0; i < requirements["languages"].length; i++) {
    let lang = requirements["languages"][i];
    if (lang.search(':') === -1 && lang.search("：") === -1 && languages.length) {
      // ['语音：英语', '法语', '德语', ..., '文本：繁体中文、简体中文', ' 2020 年 1 月 30 日即将上线：日语']
      let last = languages.length - 1;
      languages[last] += `、${lang}`;
    } else if (lang.search('-') > -1) {
      // ['语音：英语、法语、意大利语、德语、西班牙语、日语、韩语、简体中文 - 文本：俄语、葡萄牙语（巴西）']
      let l = lang.split('-');
      for (let j = 0; j < l.length; j++) {
        languages.push(l[j].trim());
      }
    } else {
      // 正常情况
      languages.push(lang);
    }
  }
  data["language"] = languages;

  // 最低配置 推荐配置 评级
  data["min_req"] = {};
  data["max_req"] = {};
  requirements["systems"].forEach(function (i) {
    let systemType = i["systemType"];
    let details = i["details"];
    data["min_req"][systemType] = details.map(x => `${x["title"]}: ${x["minimum"] || ''}`);
    data["max_req"][systemType] = details.map(x => `${x["title"]}: ${x["recommended"] || ''}`);
  });
  data["level"] = requirements["legalTags"].map(x => x["src"]);

  // 生成format
  let descr = (data["logo"] && data["logo"].length > 0) ? `[img]${data["logo"]}[/img]\n\n` : "";
  descr += "【基本信息】\n\n"; // 基本信息为原来的baseinfo块
  descr += (data["name"] && data["name"].length > 0) ? `游戏名称：${data["name"]}\n` : "";
  descr += (data["epic_link"] && data["epic_link"].length > 0) ? `商店链接：${data["epic_link"]}\n` : "";
  descr += "\n";
  descr += (data["language"] && data["language"].length > 0) ? `【支持语言】\n\n${data["language"].join("\n")}\n\n` : "";
  descr += (data["desc"] && data["desc"].length > 0) ? `【游戏简介】\n\n${data["desc"]}\n\n` : "";

  let req_list = {
    "min_req": "【最低配置】",
    "max_req": "【推荐配置】"
  };
  for (let req in req_list) {
    if (Object.entries(data[req]).length === 0 && data[req].constructor === Object) continue;
    descr += `${req_list[req]}\n\n`;
    for (let system in data[req]) {
      // noinspection JSUnfilteredForInLoop
      descr += `${system}\n${data[req][system].join("\n")}\n`;
    }
    descr += "\n\n";
  }
  descr += (data["screenshot"] && data["screenshot"].length > 0) ? `【游戏截图】\n\n${data["screenshot"].map(x => `[img]${x}[/img]`).join("\n")}\n\n` : "";
  descr += (data["level"] && data["level"].length > 0) ? `【游戏评级】\n\n${data["level"].map(x => `[img]${x}[/img]`).join("\n")}\n\n` : "";

  data["format"] = descr.trim();
  data["success"] = true; // 更新状态为成功
  return data;
}
