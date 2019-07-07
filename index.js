const cheerio = require("cheerio");  // HTML页面解析

/**
 * Cloudflare Worker entrypoint
 */
addEventListener("fetch", event => {
  event.respondWith(handle(event));
});

// 常量定义
const author_ = "Rhilip";
const version_ = "0.4.7";

const support_list = {
  // 注意value值中正则的分组只能有一个，而且必须是sid信息，其他分组必须设置不捕获属性
  "douban": /(?:https?:\/\/)?(?:(?:movie|www)\.)?douban\.com\/(?:subject|movie)\/(\d+)\/?/,
  "imdb": /(?:https?:\/\/)?(?:www\.)?imdb\.com\/title\/(tt\d+)\/?/,
  "bangumi": /(?:https?:\/\/)?(?:bgm\.tv|bangumi\.tv|chii\.in)\/subject\/(\d+)\/?/,
  "steam": /(?:https?:\/\/)?(?:store\.)?steam(?:powered|community)\.com\/app\/(\d+)\/?/,
  "indienova": /(?:https?:\/\/)?indienova\.com\/game\/(\S+)/,
  "epic": /(?:https?:\/\/)?www\.epicgames\.com\/store\/[a-z]{2}-[A-Z]{2}\/product\/(\S+)\/\S?/
};

const douban_apikey_list = [
  "02646d3fb69a52ff072d47bf23cef8fd",
  "0b2bdeda43b5688921839c8ecb20399b",
  "0dad551ec0f84ed02907ff5c42e8ec70",
  "0df993c66c0c636e29ecbb5344252a4a",
  "07c78782db00a121175696889101e363"
];

/** 公有的JSON字段，其他字段为不同生成模块的信息
 *  考虑到历史兼容的问题，应该把所有字段都放在顶层字典
 *  （虽然说最好的实践是放在 root.data 里面
 */
const default_body = {
  "success": false,   // 请求是否成功，客户端应该首先检查该字段
  "error": null,      // 如果请求失败，此处为失败原因
  "format": "",       // 使用BBCode格式整理的简介
  "copyright": `Powered by @${author_}`,   // 版权信息
  "version": version_,   // 版本
  "generate_at": 0   // 生成时间（毫秒级时间戳），可以通过这个值与当前时间戳比较判断缓存是否应该过期
};

/**
 * Fetch and log a request
 * @param {Event} event
 */
async function handle(event) {
  let request = event.request;  // 请求

  // 检查缓存，命中则直接返回
  let cache = caches.default;  // 定义缓存
  let response = await cache.match(request);

  if (!response) {
    // 使用URI() 解析request.url
    let uri = new URL(request.url);
    let site, sid;

    // 请求字段 `&url=` 存在
    if (uri.searchParams.get("url")) {
      let url_ = uri.searchParams.get("url");
      for (let site_ in support_list) {
        let pattern = support_list[site_];
        if (url_.match(pattern)) {
          site = site_;
          sid = url_.match(pattern)[1];
          break;
        }
      }
    } else {
      site = uri.searchParams.get("site");
      sid = uri.searchParams.get("sid");
    }

    try {
      // 如果site和sid不存在的话，提前返回
      if (site == null || sid == null) {
        response = makeJsonResponse({ error: "Miss key of `site` or `sid` , or input unsupported resource link" });
      } else {
        // 进入对应资源站点处理流程
        if (site === "douban") {
          response = await gen_douban(sid);
        } else if (site === "imdb") {
          response = await gen_imdb(sid);
        } else if (site === "bangumi") {
          response = await gen_bangumi(sid);
          // TODO
          //} else if (site === "steam") {
          // TODO
          //} else if (site === "indienova") {
          // TODO
          //} else if (site === "epic") {
          // TODO
        } else {
          // 没有对应方法的资源站点，（真的会有这种情况吗？
          response = makeJsonResponse({ error: "Unknown type of key `site`." });
        }
      }

      // 添加缓存 （ 此处如果response如果为undefined的话会抛出错误
      event.waitUntil(cache.put(request, response.clone()));
    } catch (e) {
      response = makeJsonResponse({ error: `Internal Error, Please contact @${author_}. Exception: ${e.message}` });
      // 当发生Internal Error的时候不应该进行cache
    }
  }

  return response;
}

//-    辅助方法      -//

// 返回Json请求
function makeJsonResponse(body_update) {
  let body = Object.assign(
    {},
    default_body,
    body_update,
    { generate_at: (new Date()).valueOf() }
  );
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"   // CORS
    }
  });
}

// 解析HTML页面
function page_parser(responseText) {
  return cheerio.load(responseText, { decodeEntities: false });
}

// 解析JSONP返回
function jsonp_parser(responseText) {
  responseText = responseText.match(/[^(]+\((.+)\)/)[1];
  return JSON.parse(responseText);
}

// 从前面定义的douban_apikey_list中随机取一个来使用
function getDoubanApiKey() {
  return douban_apikey_list[
    Math.floor(Math.random() * douban_apikey_list.length)
    ];
}

function getNumberFromString(raw) {
  return (raw.match(/[\d,]+/) || [0])[0].replace(/,/g, "");
}

// 各个资源站点的相应请求整理方法，统一使用async function
async function gen_douban(sid) {
  let data = { site: "douban", sid: sid };
  // 先处理douban上的imdb信息
  if (sid.startsWith("tt")) {
    let douban_imdb_api = await fetch(`https://api.douban.com/v2/movie/imdb/${sid}?apikey=${getDoubanApiKey()}`);
    let db_imdb_api_resp = await douban_imdb_api.json();
    let new_url = db_imdb_api_resp.alt;
    if (new_url) {
      let new_group = new_url.match(support_list.douban);
      if (new_group && !new_group[1].startsWith("tt")) {
        sid = new_group[1];   // 重写sid到豆瓣对应的值
      }
    }

    // 重新检查重写操作是否正常
    if (sid.startsWith("tt")) {
      return makeJsonResponse({ error: `Can't find this imdb_id(${sid}) in Douban.` });
    }
  }

  // 下面开始正常的豆瓣处理流程
  let douban_link = `https://movie.douban.com/subject/${sid}/`;
  let [db_page_resp, db_api_resp, awards_page_resp] = await Promise.all([
    fetch(`https://movie.douban.com/subject/${sid}/`),  // 豆瓣主页面
    fetch(`https://api.douban.com/v2/movie/${sid}?apikey=${getDoubanApiKey()}`),   // 豆瓣api
    fetch(`https://movie.douban.com/subject/${sid}/awards`)  // 豆瓣获奖界面
  ]);

  let douban_page_raw = await db_page_resp.text();
  let douban_api_json = await db_api_resp.json();
  let awards_page_raw = await awards_page_resp.text();

  // 对异常进行处理
  if (douban_api_json.msg) {
    return makeJsonResponse(Object.assign(data, { error: douban_api_json.msg }));
  } else if (douban_page_raw.match(/检测到有异常请求/)) {  // 真的会有这种可能吗？
    return makeJsonResponse(Object.assign(data, { error: "GenHelp was temporary banned by Douban, Please wait." }));
  } else {
    // 解析页面
    let $ = page_parser(douban_page_raw);
    let awards_page = page_parser(awards_page_raw);
    let title = $("title").text().replace("(豆瓣)", "").trim();

    if (title.match(/页面不存在/)) {
      return makeJsonResponse(Object.assign(data, { error: "The corresponding resource does not exist." }));  // FIXME 此时可能页面只是隐藏，而不是不存在，需要根据json信息进一步判断
    }

    // 元素获取方法
    let fetch_anchor = function(anchor) {
      return anchor[0].nextSibling.nodeValue.trim();
    };

    // 所有需要的元素
    let poster;
    let this_title, trans_title, aka;
    let year, region, genre, language, playdate;
    let imdb_link, imdb_id, imdb_average_rating, imdb_votes, imdb_rating;
    let douban_average_rating, douban_votes, douban_rating;
    let episodes, duration;
    let director, writer, cast;
    let tags, introduction, awards;

    let chinese_title = data["chinese_title"] = title;
    let foreign_title = data["foreign_title"] = $("span[property=\"v:itemreviewed\"]").text().replace(data["chinese_title"], "").trim();

    let aka_anchor = $("#info span.pl:contains(\"又名\")");
    if (aka_anchor.length > 0) {
      aka = fetch_anchor(aka_anchor).split(" / ").sort(function(a, b) {  //首字(母)排序
        return a.localeCompare(b);
      }).join("/");
      data["aka"] = aka.split("/");
    }

    if (foreign_title) {
      trans_title = chinese_title + (aka ? ("/" + aka) : "");
      this_title = foreign_title;
    } else {
      trans_title = aka ? aka : "";
      this_title = chinese_title;
    }

    data["trans_title"] = trans_title.split("/");
    data["this_title"] = this_title.split("/");

    let regions_anchor = $("#info span.pl:contains(\"制片国家/地区\")");  //产地
    let language_anchor = $("#info span.pl:contains(\"语言\")");  //语言
    let episodes_anchor = $("#info span.pl:contains(\"集数\")");  //集数
    let duration_anchor = $("#info span.pl:contains(\"单集片长\")");  //片长
    let has_imdb = $("div#info a[href^='http://www.imdb.com/title/tt']").length > 0;

    data["year"] = year = " " + $("#content > h1 > span.year").text().substr(1, 4);
    data["region"] = region = regions_anchor[0] ? fetch_anchor(regions_anchor).split(" / ") : "";

    data["genre"] = genre = $("#info span[property=\"v:genre\"]").map(function() {  //类别
      return $(this).text().trim();
    }).toArray();

    data["language"] = language = language_anchor[0] ? fetch_anchor(language_anchor).split(" / ") : "";

    data["playdate"] = playdate = $("#info span[property=\"v:initialReleaseDate\"]").map(function() {   //上映日期
      return $(this).text().trim();
    }).toArray().sort(function(a, b) {//按上映日期升序排列
      return new Date(a) - new Date(b);
    });

    if (has_imdb) {
      let imdb_link_anchor = $("#info span.pl:contains(\"IMDb链接\")");
      data["imdb_link"] = imdb_link = imdb_link_anchor.next().attr("href").replace(/(\/)?$/, "/").replace("http://", "https://");
      data["imdb_id"] = imdb_id = imdb_link.match(/tt\d+/)[0];
      let imdb_api_resp = await fetch(`https://p.media-imdb.com/static-content/documents/v1/title/${imdb_id}/ratings%3Fjsonp=imdb.rating.run:imdb.api.title.ratings/data.json`);
      let imdb_api_raw = await imdb_api_resp.text();
      let imdb_json = jsonp_parser(imdb_api_raw);

      imdb_average_rating = imdb_json["resource"]["rating"];
      imdb_votes = imdb_json["resource"]["ratingCount"];
      if (imdb_average_rating && imdb_votes) {
        data["imdb_rating"] = imdb_rating = `${imdb_average_rating}/10 from ${imdb_votes} users`;
      }
    }

    data["episodes"] = episodes = episodes_anchor[0] ? fetch_anchor(episodes_anchor) : "";
    data["duration"] = duration = duration_anchor[0] ? fetch_anchor(duration_anchor) : $("#info span[property=\"v:runtime\"]").text().trim();

    data["awards"] = awards = awards_page("#content > div > div.article").html()
      .replace(/[ \n]/g, "")
      .replace(/<\/li><li>/g, "</li> <li>")
      .replace(/<\/a><span/g, "</a> <span")
      .replace(/<(div|ul)[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/ +\n/g, "\n")
      .trim();

    data["douban_rating_average"] = douban_average_rating = douban_api_json["rating"]["average"] || 0;
    data["douban_votes"] = douban_votes = douban_api_json["rating"]["numRaters"].toLocaleString() || 0;
    data["douban_rating"] = douban_rating = `${douban_average_rating}/10 from ${douban_votes} users`;

    data["introduction"] = introduction = douban_api_json.summary.replace(/^None$/g, "暂无相关剧情介绍");
    data["poster"] = poster = douban_api_json.image.replace(/s(_ratio_poster|pic)/g, "l")
      .replace("img3", "img1");

    data["director"] = director = douban_api_json.attrs.director ? douban_api_json.attrs.director.join(" / ") : "";
    data["writer"] = writer = douban_api_json.attrs.writer ? douban_api_json.attrs.writer.join(" / ") : "";
    data["cast"] = cast = douban_api_json.attrs.cast ? douban_api_json.attrs.cast.join("\n") : "";
    data["tags"] = tags = douban_api_json.tags.map(function(member) {
      return member.name;
    });

    // 生成format
    let descr = poster ? `[img]${poster}[/img]\n\n` : "";
    descr += trans_title ? `◎译　　名　${trans_title}\n` : "";
    descr += this_title ? `◎片　　名　${this_title}\n` : "";
    descr += year ? `◎年　　代　${year.trim()}\n` : "";
    descr += region ? `◎产　　地　${region}\n` : "";
    descr += genre ? `◎类　　别　${genre.join(" / ")}\n` : "";
    descr += language ? `◎语　　言　${language}\n` : "";
    descr += playdate ? `◎上映日期　${playdate.join(" / ")}\n` : "";
    descr += imdb_rating ? `◎IMDb评分  ${imdb_rating}\n` : "";
    descr += imdb_link ? `◎IMDb链接  ${imdb_link}\n` : "";
    descr += douban_rating ? `◎豆瓣评分　${douban_rating}\n` : "";
    descr += douban_link ? `◎豆瓣链接　${douban_link}\n` : "";
    descr += episodes ? `◎集　　数　${episodes}\n` : "";
    descr += duration ? `◎片　　长　${duration}\n` : "";
    descr += director ? `◎导　　演　${director}\n` : "";
    descr += writer ? `◎编　　剧　${writer}\n` : "";
    descr += cast ? `◎主　　演　${cast.replace(/\n/g, "\n" + "　".repeat(4) + "  　").trim()}\n` : "";
    descr += tags ? `\n◎标　　签　${tags.join(" | ")}\n` : "";
    descr += introduction ? `\n◎简　　介\n\n　　${introduction.replace(/\n/g, "\n" + "　".repeat(2))}\n` : "";
    descr += awards ? `\n◎获奖情况\n\n　　${awards.replace(/\n/g, "\n" + "　".repeat(2))}\n` : "";

    data["format"] = descr;
    data["success"] = true;  // 更新状态为成功
    return makeJsonResponse(data);
  }
}

async function gen_imdb(sid) {
  let data = { site: "imdb", sid: sid };
  // 处理imdb_id tt\d{7,8} 或者 \d{0,8}
  if (sid.startsWith("tt")) {
    sid = sid.slice(2);
  }

  // 不足7位补齐到7位，如果是7、8位则直接使用
  let imdb_id = "tt" + sid.padStart(7, "0");
  let imdb_url = `https://www.imdb.com/title/${imdb_id}/`;
  let [imdb_page_resp, imdb_release_info_page_resp] = await Promise.all([
    fetch(imdb_url),
    fetch(`https://www.imdb.com/title/${imdb_id}/releaseinfo`)
  ]);

  let imdb_page_raw = await imdb_page_resp.text();

  if (imdb_page_raw.match(/404 Error - IMDb/)) {
    return makeJsonResponse(Object.assign(data, { error: "The corresponding resource does not exist." }));
  }

  let $ = page_parser(imdb_page_raw);

  // 首先解析页面中的json信息，并从中获取数据  `<script type="application/ld+json">...</script>`
  let page_json = JSON.parse(
    imdb_page_raw.match(/<script type="application\/ld\+json">([\S\s]+?)<\/script>/)[1]
      .replace(/\n/g, "")
  );

  data["imdb_id"] = imdb_id;
  data["imdb_link"] = imdb_url;

  // 处理可以直接从page_json中复制过来的信息
  let copy_items = ["@type", "name", "genre", "contentRating", "datePublished", "description", "duration"];
  for (let i = 0; i < copy_items.length; i++) {
    let copy_item = copy_items[i];
    data[copy_item] = page_json[copy_item];
  }

  data["poster"] = page_json["image"];

  if (data["datePublished"]) {
    data["year"] = data["datePublished"].slice(0, 4);
  }

  let person_items = ["actor", "director", "creator"];
  for (let i = 0; i < person_items.length; i++) {
    let person_item = person_items[i];
    let raw = page_json[person_item];

    if (!raw) continue;   // 没有对应直接直接进入下一轮

    // 有时候这个可能为一个dict而不是dict array
    if (!Array.isArray(raw)) {
      raw = [raw];
    }

    // 只要人的（Person），不要组织的（Organization）
    let item_persons = raw.filter((d) => {
      return d["@type"] === "Person";
    });

    if (item_persons.length > 0) {
      data[person_item + "s"] = item_persons.map((d) => {
        delete d["@type"];
        return d;
      });
    }
  }

  data["keywords"] = page_json["keywords"].split(",");
  let aggregate_rating = page_json["aggregateRating"] || {};

  data["imdb_votes"] = aggregate_rating["ratingCount"] || 0;
  data["imdb_rating_average"] = aggregate_rating["ratingValue"] || 0;
  data["imdb_rating"] = `${data["imdb_votes"]}/10 from ${data["imdb_rating_average"]} users`;

  // 解析页面元素
  // 第一部分： Metascore，Reviews，Popularity
  let mrp_bar = $("div.titleReviewBar > div.titleReviewBarItem");
  mrp_bar.each(function() {
    let that = $(this);
    if (that.text().match(/Metascore/)) {
      let metascore_another = that.find("div.metacriticScore");
      if (metascore_another) data["metascore"] = metascore_another.text().trim();
    } else if (that.text().match(/Reviews/)) {
      let reviews_another = that.find("a[href^=reviews]");
      let critic_another = that.find("a[href^=externalreviews]");
      if (reviews_another) data["reviews"] = getNumberFromString(reviews_another.text());
      if (critic_another) data["critic"] = getNumberFromString(critic_another.text());
    } else if (that.text().match(/Popularity/)) {
      data["popularity"] = getNumberFromString(that.text());
    }
  });

  // 第二部分： Details
  let details_another = $("div#titleDetails");
  let title_anothers = details_another.find("div.txt-block");
  let details_dict = {};
  title_anothers.each(function() {
    let title_raw = $(this).text().replace(/\n/ig, " ").replace(/See more »|Show more on {3}IMDbPro »/g, "").trim();
    if (title_raw.length > 0) {
      let title_key = title_raw.split(/: ?/, 1)[0];
      details_dict[title_key] = title_raw.replace(title_key + ":", "").replace(/ {2,}/g, " ").trim();
    }
  });
  data["details"] = details_dict;

  // 请求附属信息
  // 第一部分： releaseinfo
  let imdb_release_info_raw = await imdb_release_info_page_resp.text();
  let imdb_release_info = page_parser(imdb_release_info_raw);

  let release_date_items = imdb_release_info("tr.release-date-item");
  let release_date = [], aka = [];
  release_date_items.each(function() {
    let that = imdb_release_info(this);  // $(this) ?
    let country = that.find("td.release-date-item__country-name");
    let date = that.find("td.release-date-item__date");

    if (country && date) {
      release_date.push({ country: country.text().trim(), date: date.text().trim() });
    }
  });
  data["release_date"] = release_date;

  let aka_items = imdb_release_info("tr.aka-item");
  aka_items.each(function() {
    let that = imdb_release_info(this);
    let country = that.find("td.aka-item__name");
    let title = that.find("td.aka-item__title");

    if (country && title) {
      aka.push({ country: country.text().trim(), title: title.text().trim() });
    }
  });
  data["aka"] = aka;

  // 生成format
  let descr = data["poster"] ? `[img]${data["poster"]}[/img]\n\n` : "";
  descr += data["name"] ? `Title: ${data["name"]}\n` : "";
  descr += data["keywords"] ? `Keywords: ${data["keywords"].join(", ")}\n` : "";
  descr += data["datePublished"] ? `Date Published: ${data["datePublished"]}\n` : "";
  descr += data["imdb_rating"] ? `IMDb Rating: ${data["imdb_rating"]}\n` : "";
  descr += data["imdb_link"] ? `IMDb Link: ${data["imdb_link"]}\n` : "";
  descr += data["directors"] ? `Directors: ${data["directors"].map(i => i["name"]).join(" / ")}\n` : "";
  descr += data["creators"] ? `Creators: ${data["creators"].map(i => i["name"]).join(" / ")}\n` : "";
  descr += data["actors"] ? `Actors: ${data["actors"].map(i => i["name"]).join(" / ")}\n` : "";
  descr += data["description"] ? `\nIntroduction\n    ${data["description"].replace(/\n/g, "\n" + "　".repeat(2))}\n` : "";

  data["format"] = descr;
  data["success"] = true;  // 更新状态为成功
  return makeJsonResponse(data);
}

async function gen_bangumi(sid) {
  let data = { site: "bangumi", sid: sid };

  // 请求页面
  let bangumi_link = `https://bgm.tv/subject/${sid}`;
  let [bangumi_page_resp, bangumi_characters_resp] = await Promise.all([
    fetch(bangumi_link),
    fetch(`https://bgm.tv/subject/${sid}/characters`)
  ]);

  let bangumi_page_raw = await bangumi_page_resp.text();

  if (bangumi_page_raw.match(/呜咕，出错了/)) {
    return makeJsonResponse(Object.assign(data, { error: "The corresponding resource does not exist." }));
  }

  data["alt"] = bangumi_link;
  let $ = page_parser(bangumi_page_raw);

  // 对页面进行划区
  let cover_staff_another = $("div#bangumiInfo");
  let cover_another = cover_staff_another.find("a.thickbox.cover");
  let staff_another = cover_staff_another.find("ul#infobox");
  let story_another = $("div#subject_summary");
  // let cast_another = $('div#browserItemList');

  console.log(cover_staff_another.html());

  /*  data['cover'] 为向前兼容项，之后均用 poster 表示海报
   *  这里有个问题，就是仍按 img.attr('src') 会取不到值因为 cf-worker中fetch 返回的html片段如下 ： https://pastebin.com/0wPLAf8t
   *  暂时不明白是因为 cf-worker 的问题还是 cf-CDN 的问题，因为直接源代码审查未发现该片段。
   */
  data["cover"] = data["poster"] = cover_another ? ("https:" + cover_another.attr("href")).replace(/\/cover\/[lcmsg]\//, "/cover/l/") : "";
  data["story"] = story_another ? story_another.text().trim() : "";
  data["staff"] = staff_another.find("li")
    .slice(4, 4 + 15)   // 读取第4-19行  （假定bgm的顺序为中文名、话数、放送开始、放送星期...，对新番适用，较老番组可能不好  ，staff从第四个 导演 起算）
    .map(function() {
      return $(this).text();
    })
    .get();

  let bangumi_characters_page_raw = await bangumi_characters_resp.text();
  let bangumi_characters_page = page_parser(bangumi_characters_page_raw);
  let cast_actors = bangumi_characters_page("div#columnInSubjectA > div.light_odd > div.clearit");

  data["cast"] = cast_actors
    .slice(0, 9)   // 读取前9项cast信息
    .map(function() {
      let tag = bangumi_characters_page(this);
      let h2 = tag.find("h2");
      let char = (h2.find("span.tip") || h2.find("a")).text().replace(/\//, "").trim();
      let cv = tag.find("div.clearit > p").map(function() {
        let p = bangumi_characters_page(this);
        return (p.find("small") || p.find("a")).text().trim();
      }).get().join("，");
      return `${char}: ${cv}`;
    }).get();

  // 生成format
  let descr = data["poster"] ? `[img]${data["poster"]}[/img]\n\n` : "";
  descr += data["story"] ? `[b]Story: [/b]\n\n${data["story"]}\n\n` : "";
  descr += data["staff"] ? `[b]Staff: [/b]\n\n${data["staff"].join("\n")}\n\n` : "";
  descr += data["cast"] ? `[b]Cast: [/b]\n\n${data["cast"].join("\n")}\n\n` : "";
  descr += data["alt"] ? `(来源于 ${data["alt"]} )\n` : "";

  data["format"] = descr;
  data["success"] = true;  // 更新状态为成功
  return makeJsonResponse(data);
}