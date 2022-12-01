import {jsonp_parser, NONE_EXIST_ERROR, page_parser, html2bbcode} from "./common";

export async function gen_steam(sid) {
  let data = {
    site: "steam",
    sid: sid
  };

  let steam_page_resp = await fetch(`https://store.steampowered.com/app/${sid}/?l=schinese`, {
    redirect: "manual",
    headers: { // 使用Cookies绕过年龄检查和成人内容提示，并强制中文
      "Cookie": "lastagecheckage=1-January-1975; birthtime=157737601; mature_content=1; wants_mature_content=1; Steam_Language=schinese"
    }
  });

  // 不存在的资源会被302到首页，故检查标题
  if (steam_page_resp.status === 302) {
    return Object.assign(data, {
      error: NONE_EXIST_ERROR
    });
  } else if (steam_page_resp.status === 403) {
    return Object.assign(data, {
      error: "GenHelp was temporary banned by Steam Server, Please wait...."
    });
  }

  data["steam_id"] = sid;

  // 立即请求附加资源
  let steamcn_api_req = fetch(`https://steamdb.keylol.com/app/${sid}/data.js?v=38`);
  let $ = page_parser(await steam_page_resp.text());

  // 从网页中定位数据
  let name_anchor = $("div.apphub_AppName") || $("span[itemprop=\"name\"]"); // 游戏名
  let cover_anchor = $("img.game_header_image_full[src]"); // 游戏封面图
  let detail_anchor = $("div.details_block"); // 游戏基本信息
  let linkbar_anchor = $("a.linkbar"); // 官网
  let language_anchor = $("table.game_language_options tr[class!=unsupported]"); // 支持语言
  let tag_anchor = $("a.app_tag"); // 标签
  let rate_anchor = $("div.user_reviews_summary_row"); // 游戏评价
  let descr_anchor = $("div#game_area_description"); // 游戏简介
  let sysreq_anchor = $("div.sysreq_contents > div.game_area_sys_req"); // 系统需求
  let screenshot_anchor = $("div.screenshot_holder a"); // 游戏截图

  data["cover"] = data["poster"] = cover_anchor ? cover_anchor.attr("src").replace(/^(.+?)(\?t=\d+)?$/, "$1") : "";
  data["name"] = name_anchor ? name_anchor.text().trim() : "";
  data["detail"] = detail_anchor ?
    detail_anchor.eq(0).text()
      .replace(/:[ 	\n]+/g, ": ")
      .split("\n")
      .map(x => x.trim())
      .filter(x => x.length > 0)
      .join("\n") : "";
  data["tags"] = tag_anchor ? tag_anchor.map(function () {
    return $(this).text().trim();
  }).get() : [];
  data["review"] = rate_anchor ? rate_anchor.map(function () {
    return $(this).text().replace("：", ":").replace(/[ 	\n]{2,}/ig, " ").trim();
  }).get() : [];
  if (linkbar_anchor && linkbar_anchor.text().search("访问网站")) {
    data["linkbar"] = linkbar_anchor.attr("href").replace(/^.+?url=(.+)$/, "$1");
  }

  const lag_checkcol_list = ["界面", "完全音频", "字幕"];
  data["language"] = language_anchor ?
    language_anchor
      .slice(1, 4) // 不要首行，不要不支持行 外的前三行
      .map(function () {
        let tag = $(this);
        let tag_td_list = tag.find("td");
        let lag_support_checkcol = [];
        let lag = tag_td_list.eq(0).text().trim();

        for (let i = 0; i < lag_checkcol_list.length; i++) {
          let j = tag_td_list.eq(i + 1);
          if (j.text().search("✔")) {
            lag_support_checkcol.push(lag_checkcol_list[i]);
          }
        }

        return `${lag}${lag_support_checkcol.length > 0 ? ` (${lag_support_checkcol.join(", ")})` : ""}`;
      }).get() : [];

  data["descr"] = descr_anchor ? html2bbcode(descr_anchor.html()).replace("[h2]关于这款游戏[/h2]", "").trim() : "";
  data["screenshot"] = screenshot_anchor ? screenshot_anchor.map(function () {
    let dic = $(this);
    return dic.attr("href").replace(/^.+?url=(http.+?)\.[\dx]+(.+?)(\?t=\d+)?$/, "$1$2");
  }).get() : [];

  const os_dict = {
    "win": "Windows",
    "mac": "Mac OS X",
    "linux": "SteamOS + Linux"
  };
  data["sysreq"] = sysreq_anchor ? sysreq_anchor.map(function () {
    let tag = $(this);
    let os_type = os_dict[tag.attr("data-os")];

    let clone_tag = tag.clone();
    clone_tag.html(tag.html().replace(/<br>/ig, "[br]"));

    let sysreq_content = clone_tag
      .text()
      .split("\n").map(x => x.trim()).filter(x => x.length > 0).join("\n\n") // 处理最低配置和最高配置之间的空白行
      .split("[br]").map(x => x.trim()).filter(x => x.length > 0).join("\n"); // 处理配置内的分行

    return `${os_type}\n${sysreq_content}`;
  }).get() : [];

  // 处理附加资源
  let steamcn_api_resp = await steamcn_api_req;
  let steamcn_api_jsonp = await steamcn_api_resp.text();
  let steamcn_api_json = jsonp_parser(steamcn_api_jsonp);
  if (steamcn_api_json["name_cn"]) data["name_chs"] = steamcn_api_json["name_cn"];

  // 生成format
  let descr = (data["poster"] && data["poster"].length > 0) ? `[img]${data["poster"]}[/img]\n\n` : "";
  descr += "【基本信息】\n\n"; // 基本信息为原来的baseinfo块
  descr += (data["name_chs"] && data["name_chs"].length > 0) ? `中文名: ${data["name_chs"]}\n` : "";
  descr += (data["detail"] && data["detail"].length > 0) ? `${data["detail"]}\n` : "";
  descr += (data["linkbar"] && data["linkbar"].length > 0) ? `官方网站: ${data["linkbar"]}\n` : "";
  descr += (data["steam_id"] && data["steam_id"].length > 0) ? `Steam页面: https://store.steampowered.com/app/${data["steam_id"]}/\n` : "";
  descr += (data["language"] && data["language"].length > 0) ? `游戏语种: ${data["language"].join(" | ")}\n` : "";
  descr += (data["tags"] && data["tags"].length > 0) ? `标签: ${data["tags"].join(" | ")}\n` : "";
  descr += (data["review"] && data["review"].length > 0) ? `\n${data["review"].join("\n")}\n` : "";
  descr += "\n";
  descr += (data["descr"] && data["descr"].length > 0) ? `【游戏简介】\n\n${data["descr"]}\n\n` : "";
  descr += (data["sysreq"] && data["sysreq"].length > 0) ? `【配置需求】\n\n${data["sysreq"].join("\n")}\n\n` : "";
  descr += (data["screenshot"] && data["screenshot"].length > 0) ? `【游戏截图】\n\n${data["screenshot"].map(x => `[img]${x}[/img]`).join("\n")}\n\n` : "";

  data["format"] = descr.trim();
  data["success"] = true; // 更新状态为成功
  return data;
}
