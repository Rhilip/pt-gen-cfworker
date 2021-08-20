import { page_parser, NONE_EXIST_ERROR } from "./common";

export async function search_bangumi(query) {
  const tp_dict = {1: "漫画/小说", 2: "动画/二次元番", 3: "音乐", 4: "游戏", 6: "三次元番"};
  let bgm_search = await fetch(`http://api.bgm.tv/search/subject/${query}?responseGroup=large`)
  let bgm_search_json = await bgm_search.json();
  return {
    data: bgm_search_json.list.map(d => {
      return {
        year: d['air_date'].slice(0, 4),
        subtype: tp_dict[d['type']],
        title: d['name_cn'] !== '' ? d['name_cn'] : d['name'],
        subtitle: d['name'],
        link: d['url']
      }
    })
  }
}

export async function gen_bangumi(sid) {
  let data = {
    site: "bangumi",
    sid: sid
  };

  // 请求页面
  let bangumi_link = `https://bgm.tv/subject/${sid}`;
  let bangumi_page_resp = await fetch(bangumi_link);
  let bangumi_page_raw = await bangumi_page_resp.text();
  if (bangumi_page_raw.match(/呜咕，出错了/)) {
    return Object.assign(data, {
      error: NONE_EXIST_ERROR
    });
  }

  data["alt"] = bangumi_link;

  // 立即请求附加资源
  let bangumi_characters_req = fetch(`${bangumi_link}/characters`)

  let $ = page_parser(bangumi_page_raw);

  // 对页面进行划区
  let cover_staff_another = $("div#bangumiInfo");
  let cover_another = cover_staff_another.find("a.thickbox.cover");
  let info_another = cover_staff_another.find("ul#infobox");
  let story_another = $("div#subject_summary");
  // let cast_another = $('div#browserItemList');

  /*  data['cover'] 为向前兼容项，之后均用 poster 表示海报
   *  这里有个问题，就是仍按 img.attr('src') 会取不到值因为 cf-worker中fetch 返回的html片段如下 ： https://pastebin.com/0wPLAf8t
   *  暂时不明白是因为 cf-worker 的问题还是 cf-CDN 的问题，因为直接源代码审查未发现该片段。
   */
  data["cover"] = data["poster"] = cover_another ? ("https:" + cover_another.attr("href")).replace(/\/cover\/[lcmsg]\//, "/cover/l/") : "";
  data["story"] = story_another ? story_another.text().trim() : "";

  // 中文名、话数、放送开始、放送星期等信息 不视为staff列表项，将其转存进info项中
  let info = info_another.find("li").map(function () {
    return $(this).text();
  }).get();
  data["staff"] = info.filter(d => {
    return !/^(中文名|话数|放送开始|放送星期|别名|官方网站|播放电视台|其他电视台|Copyright)/.test(d)
  });
  data["info"] = info.filter(d => !(data["staff"].includes(d)));

  // ---其他页面信息，但是暂未放入format中

  // 评分信息
  data["bangumi_votes"] = $('span[property="v:votes"]').text();
  data["bangumi_rating_average"] = $('div.global_score > span[property="v:average"]').text();

  // 标签
  data["tags"] = $('#subject_detail > div.subject_tag_section > div > a > span').map(function () {
    return $(this).text()
  }).get()

  // ---其他暂未放入format的页面信息结束

  // 角色信息
  let bangumi_characters_resp = await bangumi_characters_req;
  let bangumi_characters_page_raw = await bangumi_characters_resp.text();
  let bangumi_characters_page = page_parser(bangumi_characters_page_raw);
  let cast_actors = bangumi_characters_page("div#columnInSubjectA > div.light_odd > div.clearit");

  data["cast"] = cast_actors.map(function () {
    let tag = bangumi_characters_page(this);
    let h2 = tag.find("h2");
    let char = (h2.find("span.tip").text() || h2.find("a").text()).replace(/\//, "").trim();
    let cv = tag.find("div.clearit > p").map(function () {
      let p = bangumi_characters_page(this);
      return (p.find("small") || p.find("a")).text().trim();
    }).get().join("，");
    return `${char}: ${cv}`;
  }).get();

  // 生成format
  let descr = (data["poster"] && data["poster"].length > 0) ? `[img]${data["poster"]}[/img]\n\n` : "";
  descr += (data["story"] && data["story"].length > 0) ? `[b]Story: [/b]\n\n${data["story"]}\n\n` : "";
  // 读取前15项staff信息
  descr += (data["staff"] && data["staff"].length > 0) ? `[b]Staff: [/b]\n\n${data["staff"].slice(0, 15).join("\n")}\n\n` : "";
  // 读取前9项cast信息
  descr += (data["cast"] && data["cast"].length > 0) ? `[b]Cast: [/b]\n\n${data["cast"].slice(0, 9).join("\n")}\n\n` : "";
  descr += (data["alt"] && data["alt"].length > 0) ? `(来源于 ${data["alt"]} )\n` : "";

  data["format"] = descr.trim();
  data["success"] = true; // 更新状态为成功
  return data;
}
