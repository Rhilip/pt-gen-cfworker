const cheerio = require("cheerio");

// 主入口
addEventListener("fetch", event => {
  event.respondWith(handle(event));
});

const author_ = "Rhilip";
const version_ = "0.4.7";

const support_list = {
  "douban": /(?:https?:\/\/)?(?:(?:movie|www)\.)?douban\.com\/(?:subject|movie)\/(\d+)\/?/,
  "imdb": /(?:https?:\/\/)?www\.imdb\.com\/title\/(tt\d+)/,
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

const default_body = {
  "success": false,
  "error": null,
  "format": "",
  "copyright": `Powered by @${author_}`,
  "version": version_
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
          let group = url_.match(pattern);
          site = site_;
          sid = group[1];
          break;
        }
      }
    } else {
            site = uri.searchParams.get("site");
      sid = uri.searchParams.get("sid");
    }

    // 如果site和sid不存在的话，提前返回
        if (site == null || sid == null) {
      response = makeJsonResponse({ error: "Miss key of `site` or `sid` , or input unsupported resource link" });
    } else {
      if (site === "douban") {
        response = await gen_douban(sid);
        //} else if (site === "imdb") {
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

    

    // 添加缓存
    event.waitUntil(cache.put(request, response.clone()));
  }

  return response;
}

// 辅助方法
function makeJsonResponse(body_update) {
  let body = Object.assign({}, default_body, body_update);
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function page_parser(responseText) {
  // 替换一些信息防止图片和页面脚本的加载，同时可能加快页面解析速度
  responseText = responseText.replace(/s+src=/ig, " data-src="); // 图片，部分外源脚本
  responseText = responseText.replace(/<script[^>]*?>[\S\s]*?<\/script>/ig, ""); //页面脚本
  return cheerio.load(responseText, { decodeEntities: false });
}

function jsonp_parser(responseText) {
  responseText = responseText.match(/[^(]+\((.+)\)/)[1];
  return JSON.parse(responseText);
}

function getDoubanApiKey() {
  return douban_apikey_list[
    Math.floor(Math.random() * douban_apikey_list.length)
    ];
}

// 各个资源站点的相应请求整理方法，统一使用async function

async function gen_douban(sid) {
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
    fetch(`https://movie.douban.com/subject/${sid}/`),
    fetch(`https://api.douban.com/v2/movie/${sid}?apikey=${getDoubanApiKey()}`),
    fetch(`https://movie.douban.com/subject/${sid}/awards`)
  ]);

  let douban_page_raw = await db_page_resp.text();
  let douban_api_json = await db_api_resp.json();
  let awards_page_raw = await awards_page_resp.text();

  // 对异常进行处理
  if (douban_api_json.msg) {
    return makeJsonResponse({ error: douban_api_json.msg });
  } else if (douban_page_raw.match(/检测到有异常请求/)) {  // 真的会有这种可能吗？
    return makeJsonResponse({ error: "GenHelp was temporary banned by Douban, Please wait." });
  } else {
    // 解析页面
    let $ = page_parser(douban_page_raw);
    let awards_page = page_parser(awards_page_raw);
    let title = $("title").text().replace("(豆瓣)", "").trim();

    if (title.match(/页面不存在/)) {
      return makeJsonResponse({ error: "The corresponding resource does not exist." });  // FIXME 此时可能页面只是隐藏，而不是不存在，需要根据json信息进一步判断
    }

    // 所有检查完成，开始解析页面
    let data = { success: true };

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

    data["awards"] = awards = awards_page("#content > div > div.article").html()   // 这里因为cheerio 是 &#x ，需要unescape
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
    let descr = "";
    descr += poster ? `[img]${poster}[/img]\n\n` : "";
    descr += trans_title ? `◎译　　名　${trans_title}\n` : "";
    descr += this_title ? `◎片　　名　${this_title}\n` : "";
    descr += year ? `◎年　　代　${year.trim()}\n` : "";
    descr += region ? `◎产　　地　${region}\n` : "";
    descr += genre ? `◎类　　别　${genre.join(" / ")}\n` : "";
    descr += language ? `◎语　　言　${language}\n` : "";
    descr += playdate ? `◎上映日期　${playdate.join(" / ")}\n` : "";
    descr += imdb_rating ? `◎IMDb评分  ${imdb_rating}\n` : "";  // 注意如果长时间没能请求完成imdb信息，则该条不显示
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
    
    return makeJsonResponse(data);
  }
}
