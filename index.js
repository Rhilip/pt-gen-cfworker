const cheerio = require("cheerio"); // HTML页面解析
const HTML2BBCode = require("html2bbcode").HTML2BBCode;

/**
 * Cloudflare Worker entrypoint
 */
addEventListener("fetch", event => {
  event.respondWith(handle(event));
});

// 常量定义
const AUTHOR = "Rhilip";
const VERSION = "0.6.1";

const support_list = {
  // 注意value值中正则的分组只能有一个，而且必须是sid信息，其他分组必须设置不捕获属性
  "douban": /(?:https?:\/\/)?(?:(?:movie|www)\.)?douban\.com\/(?:subject|movie)\/(\d+)\/?/,
  "imdb": /(?:https?:\/\/)?(?:www\.)?imdb\.com\/title\/(tt\d+)\/?/,
  "bangumi": /(?:https?:\/\/)?(?:bgm\.tv|bangumi\.tv|chii\.in)\/subject\/(\d+)\/?/,
  "steam": /(?:https?:\/\/)?(?:store\.)?steam(?:powered|community)\.com\/app\/(\d+)\/?/,
  "indienova": /(?:https?:\/\/)?indienova\.com\/game\/(\S+)/,
  "epic": /(?:https?:\/\/)?www\.epicgames\.com\/store\/[a-zA-Z-]+\/product\/(\S+)\/\S?/
};

const support_site_list = Object.keys(support_list);

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

const NONE_EXIST_ERROR = "The corresponding resource does not exist.";

/**
 * Fetch and log a request
 * @param {Event} event
 */
async function handle(event) {
  const request = event.request; // 获取请求
  
  // 处理OPTIONS
  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  // 检查缓存，命中则直接返回
  const cache = caches.default; // 定义缓存
  let response = await cache.match(request);

  if (!response) { // 未命中缓存
    // 使用URI() 解析request.url
    let uri = new URL(request.url);

    try {
      // 不存在任何请求字段，且在根目录，返回默认页面（HTML）
      if (uri.pathname === '/' && uri.search === '') {
        response = await makeIndexResponse();
      }
      // 其他的请求均应视为ajax请求，返回JSON
      else if (uri.searchParams.get('search')) {
        // 搜索类（通过PT-Gen代理）
        let keywords = uri.searchParams.get('search');
        let source = uri.searchParams.get('source') || 'douban';

        if (support_site_list.includes(source)) {
          if (source === 'douban') {
            response = await search_douban(keywords)
          } else if (source === 'bangumi') {
            response = await search_bangumi(keywords)
          } else {
            // 没有对应方法搜索的资源站点
            response = makeJsonResponse({
              error: "Miss search function for `source`: " + source + "."
            });
          }
        } else {
          response = makeJsonResponse({
            error: "Unknown value of key `source`."
          });
        }
      } else {
        // 内容生成类
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

        // 如果site和sid不存在的话，提前返回
        if (site == null || sid == null) {
          response = makeJsonResponse({
            error: "Miss key of `site` or `sid` , or input unsupported resource `url`."
          });
        } else {
          if (support_site_list.includes(site)) {
            // 进入对应资源站点处理流程
            if (site === "douban") {
              response = await gen_douban(sid);
            } else if (site === "imdb") {
              response = await gen_imdb(sid);
            } else if (site === "bangumi") {
              response = await gen_bangumi(sid);
            } else if (site === "steam") {
              response = await gen_steam(sid);
            } else if (site === "indienova") {
              response = await gen_indienova(sid);
            } else if (site === "epic") {
              response = await gen_epic(sid);
            } else {
              // 没有对应方法的资源站点，（真的会有这种情况吗？
              response = makeJsonResponse({
                error: "Miss generate function for `site`: " + site + "."
              });
            }
          } else {
            response = makeJsonResponse({
              error: "Unknown value of key `site`."
            });
          }
        }
      }

      // 添加缓存，此处如果response如果为undefined的话会抛出错误
      event.waitUntil(cache.put(request, response.clone()));
    } catch (e) {
      let err_return = {
        error: `Internal Error, Please contact @${AUTHOR}. Exception: ${e.message}`
      };
      
      if (uri.searchParams.get("debug") === '1') {
        err_return['debug'] = debug_get_err(e, request);
      }

      response = makeJsonResponse(err_return);
      // 当发生Internal Error的时候不应该进行cache
    }
  }

  return response;
}

//-    辅助方法      -//
function handleOptions(request) {
  if (request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null &&
    request.headers.get("Access-Control-Request-Headers") !== null) {
    // Handle CORS pre-flight request.
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
        "Access-Control-Allow-Headers": "Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers"
      }
    })
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        "Allow": "GET, HEAD, OPTIONS",
      }
    })
  }
}

// 返回Json请求
function makeJsonResponse(body_update) {
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

// 解析HTML页面
function page_parser(responseText) {
  return cheerio.load(responseText, {
    decodeEntities: false
  });
}

// 解析JSONP返回
function jsonp_parser(responseText) {
  responseText = responseText.match(/[^(]+\((.+)\)/)[1];
  return JSON.parse(responseText);
}

// Html2bbcode
function html2bbcode(html) {
  let converter = new HTML2BBCode();
  let bbcode = converter.feed(html);
  return bbcode.toString();
}

function getNumberFromString(raw) {
  return (raw.match(/[\d,]+/) || [0])[0].replace(/,/g, "");
}

function debug_get_err(err, request) {
  const errType = err.name || (err.contructor || {}).name;
  const frames = parse_err(err);
  const extraKeys = Object.keys(err).filter(key => !['name', 'message', 'stack'].includes(key));
  return {
    message: errType + ': ' + (err.message || '<no message>'),
    exception: {
      values: [
        {
          type: errType,
          value: err.message,
          stacktrace: frames.length ? { frames: frames.reverse() } : undefined,
        },
      ],
    },
    extra: extraKeys.length
      ? {
          [errType]: extraKeys.reduce((obj, key) => ({ ...obj, [key]: err[key] }), {}),
        }
      : undefined,
    timestamp: Date.now() / 1000,
    request:
      request && request.url
        ? {
            method: request.method,
            url: request.url,
            query_string: request.query,
            headers: request.headers,
            data: request.body,
          }
        : undefined,
  }
}

function parse_err(err) {
  return (err.stack || '')
    .split('\n')
    .slice(1)
    .map(line => {
      if (line.match(/^\s*[-]{4,}$/)) {
        return { filename: line }
      }

      // From https://github.com/felixge/node-stack-trace/blob/1ec9ba43eece124526c273c917104b4226898932/lib/stack-trace.js#L42
      const lineMatch = line.match(/at (?:(.+)\s+\()?(?:(.+?):(\d+)(?::(\d+))?|([^)]+))\)?/);
      if (!lineMatch) {
        return
      }

      return {
        function: lineMatch[1] || undefined,
        filename: lineMatch[2] || undefined,
        lineno: +lineMatch[3] || undefined,
        colno: +lineMatch[4] || undefined,
        in_app: lineMatch[5] !== 'native' || undefined,
      }
    })
    .filter(Boolean)
}

// 各个资源站点的相应资源搜索整理方法
async function search_douban(query) {
  let douban_search = await fetch(`https://movie.douban.com/j/subject_suggest?q=${query}`);
  let douban_search_json = await douban_search.json();

  return makeJsonResponse({
    data: douban_search_json.map(d => {
      return {
        year: d.year,
        subtype: d.type,
        title: d.title,
        subtitle: d.subtitle,
        link: `https://movie.douban.com/subject/${d.id}/`
      }
    })
  })
}

async function search_bangumi(query) {
  const tp_dict = {1: "漫画/小说", 2: "动画/二次元番", 3: "音乐", 4: "游戏", 6: "三次元番"};
  let bgm_search = await fetch(`http://api.bgm.tv/search/subject/${query}?responseGroup=large`)
  let bgm_search_json = await bgm_search.json();
  return makeJsonResponse({
    data: bgm_search_json.list.map(d => {
      return {
        year: d['air_date'].slice(0, 4),
        subtype: tp_dict['type'],
        title: d['name_cn'],
        subtitle: d['name'],
        link: d['url']
      }
    })
  })
}

// 各个资源站点的相应请求整理方法，统一使用async function
async function gen_douban(sid) {
  let data = {
    site: "douban",
    sid: sid
  };

  // 下面开始正常的豆瓣处理流程
  let douban_link = `https://movie.douban.com/subject/${sid}/`;
  let [db_page_resp, awards_page_resp] = await Promise.all([
    fetch(`https://movie.douban.com/subject/${sid}/`), // 豆瓣主页面
    fetch(`https://movie.douban.com/subject/${sid}/awards`) // 豆瓣获奖界面
  ]);

  let douban_page_raw = await db_page_resp.text();

  // 对异常进行处理
  if (douban_page_raw.match(/你想访问的页面不存在/)) {
    return makeJsonResponse(Object.assign(data, {
      error: NONE_EXIST_ERROR
    }));
  } else if (douban_page_raw.match(/检测到有异常请求/)) { // 真的会有这种可能吗？
    return makeJsonResponse(Object.assign(data, {
      error: "GenHelp was temporary banned by Douban, Please wait...."
    }));
  } else {
    // 解析页面
    let $ = page_parser(douban_page_raw);

    let title = $("title").text().replace("(豆瓣)", "").trim();

    // 从ld+json中获取原来API返回的部分信息
    let ld_json = JSON.parse($('head > script[type="application/ld+json"]').html().replace(/\n/ig,''));

    // 元素获取方法
    let fetch_anchor = function (anchor) {
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

    // 提前imdb相关请求
    let imdb_link_anchor = $("div#info a[href*='://www.imdb.com/title/tt']");
    let has_imdb = imdb_link_anchor.length > 0;
    if (has_imdb) {
      data["imdb_link"] = imdb_link = imdb_link_anchor.attr("href").replace(/(\/)?$/, "/").replace("http://", "https://");
      data["imdb_id"] = imdb_id = imdb_link.match(/tt\d+/)[0];
      let imdb_api_resp = await fetch(`https://p.media-imdb.com/static-content/documents/v1/title/${imdb_id}/ratings%3Fjsonp=imdb.rating.run:imdb.api.title.ratings/data.json`);
      let imdb_api_raw = await imdb_api_resp.text();
      let imdb_json = jsonp_parser(imdb_api_raw);

      imdb_average_rating = imdb_json["resource"]["rating"] || 0;
      imdb_votes = imdb_json["resource"]["ratingCount"] || 0;
      if (imdb_average_rating && imdb_votes) {
        data["imdb_votes"] = imdb_votes;
        data["imdb_rating_average"] = imdb_average_rating;
        data["imdb_rating"] = imdb_rating = `${imdb_average_rating}/10 from ${imdb_votes} users`;
      }
    }

    let chinese_title = data["chinese_title"] = title;
    let foreign_title = data["foreign_title"] = $("span[property=\"v:itemreviewed\"]").text().replace(data["chinese_title"], "").trim();

    let aka_anchor = $("#info span.pl:contains(\"又名\")");
    if (aka_anchor.length > 0) {
      aka = fetch_anchor(aka_anchor).split(" / ").sort(function (a, b) { //首字(母)排序
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

    let regions_anchor = $("#info span.pl:contains(\"制片国家/地区\")"); //产地
    let language_anchor = $("#info span.pl:contains(\"语言\")"); //语言
    let episodes_anchor = $("#info span.pl:contains(\"集数\")"); //集数
    let duration_anchor = $("#info span.pl:contains(\"单集片长\")"); //片长

    data["year"] = year = " " + $("#content > h1 > span.year").text().substr(1, 4);
    data["region"] = region = regions_anchor[0] ? fetch_anchor(regions_anchor).split(" / ") : "";

    data["genre"] = genre = $("#info span[property=\"v:genre\"]").map(function () { //类别
      return $(this).text().trim();
    }).toArray();

    data["language"] = language = language_anchor[0] ? fetch_anchor(language_anchor).split(" / ") : "";

    data["playdate"] = playdate = $("#info span[property=\"v:initialReleaseDate\"]").map(function () { //上映日期
      return $(this).text().trim();
    }).toArray().sort(function (a, b) { //按上映日期升序排列
      return new Date(a) - new Date(b);
    });

    data["episodes"] = episodes = episodes_anchor[0] ? fetch_anchor(episodes_anchor) : "";
    data["duration"] = duration = duration_anchor[0] ? fetch_anchor(duration_anchor) : $("#info span[property=\"v:runtime\"]").text().trim();

    // 简介 （首先检查是不是有隐藏的，如果有，则直接使用隐藏span的内容作为简介，不然则用 span[property="v:summary"] 的内容）
    data["introduction"] = introduction = (
      $('#link-report > span.all.hidden').length > 0 ? $('#link-report > span.all.hidden').text()  // 隐藏部分
        : ($('[property="v:summary"]').length > 0 ? $('[property="v:summary"]').text() : '暂无相关剧情介绍')
    ).trim().split('\n').map(a => a.trim()).join('\n');  // 处理简介缩进

    // 从ld_json中获取信息
    data["douban_rating_average"] = douban_average_rating = ld_json['aggregateRating'] ? ld_json['aggregateRating']['ratingValue'] : 0;
    data["douban_votes"] = douban_votes = ld_json['aggregateRating'] ? ld_json['aggregateRating']['ratingCount'] : 0;
    data["douban_rating"] = douban_rating = `${douban_average_rating}/10 from ${douban_votes} users`;

    data["poster"] = poster = ld_json['image']
      .replace(/s(_ratio_poster|pic)/g, "l$1")
      .replace("img3", "img1");

    data["director"] = director = ld_json['director'] ? ld_json['director'] : [];
    data["writer"] = writer = ld_json['author'] ? ld_json['author'] : [];
    data["cast"] = cast = ld_json['actor'] ? ld_json['actor'] : [];

    let tag_another = $('div.tags-body > a[href^="/tag"]');
    if (tag_another.length > 0) {
      data["tags"] = tags = tag_another.map(function () {return $(this).text()}).get();
    }

    let awards_page_raw = await awards_page_resp.text();
    let awards_page = page_parser(awards_page_raw);
    data["awards"] = awards = awards_page("#content > div > div.article").html()
      .replace(/[ \n]/g, "")
      .replace(/<\/li><li>/g, "</li> <li>")
      .replace(/<\/a><span/g, "</a> <span")
      .replace(/<(div|ul)[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/ +\n/g, "\n")
      .trim();

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
    descr += director && director.length > 0 ? `◎导　　演　${director.map(x => x['name']).join(" / ")}\n` : "";
    descr += writer && writer.length > 0 ? `◎编　　剧　${writer.map(x => x['name']).join(" / ")}\n` : "";
    descr += cast && cast.length > 0 ? `◎主　　演　${cast.map(x => x['name']).join("\n" + "　".repeat(4) + "  　").trim()}\n` : "";
    descr += tags && tags.length > 0 ? `\n◎标　　签　${tags.join(" | ")}\n` : "";
    descr += introduction ? `\n◎简　　介\n\n　　${introduction.replace(/\n/g, "\n" + "　".repeat(2))}\n` : "";
    descr += awards ? `\n◎获奖情况\n\n　　${awards.replace(/\n/g, "\n" + "　".repeat(2))}\n` : "";

    data["format"] = descr.trim();
    data["success"] = true; // 更新状态为成功
    return makeJsonResponse(data);
  }
}

async function gen_imdb(sid) {
  let data = {
    site: "imdb",
    sid: sid
  };
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
    return makeJsonResponse(Object.assign(data, {
      error: NONE_EXIST_ERROR
    }));
  }

  let $ = page_parser(imdb_page_raw);

  // 首先解析页面中的json信息，并从中获取数据  `<script type="application/ld+json">...</script>`
  let page_json = JSON.parse($('script[type="application/ld+json"]').html().replace(/\n/ig,''));

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

    if (!raw) continue; // 没有对应直接直接进入下一轮

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
  mrp_bar.each(function () {
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
  title_anothers.each(function () {
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
  let release_date = [],
    aka = [];
  release_date_items.each(function () {
    let that = imdb_release_info(this); // $(this) ?
    let country = that.find("td.release-date-item__country-name");
    let date = that.find("td.release-date-item__date");

    if (country && date) {
      release_date.push({
        country: country.text().trim(),
        date: date.text().trim()
      });
    }
  });
  data["release_date"] = release_date;

  let aka_items = imdb_release_info("tr.aka-item");
  aka_items.each(function () {
    let that = imdb_release_info(this);
    let country = that.find("td.aka-item__name");
    let title = that.find("td.aka-item__title");

    if (country && title) {
      aka.push({
        country: country.text().trim(),
        title: title.text().trim()
      });
    }
  });
  data["aka"] = aka;

  // 生成format
  let descr = (data["poster"] && data["poster"].length > 0) ? `[img]${data["poster"]}[/img]\n\n` : "";
  descr += (data["name"] && data["name"].length > 0) ? `Title: ${data["name"]}\n` : "";
  descr += (data["keywords"] && data["keywords"].length > 0) ? `Keywords: ${data["keywords"].join(", ")}\n` : "";
  descr += (data["datePublished"] && data["datePublished"].length > 0) ? `Date Published: ${data["datePublished"]}\n` : "";
  descr += (data["imdb_rating"] && data["imdb_rating"].length > 0) ? `IMDb Rating: ${data["imdb_rating"]}\n` : "";
  descr += (data["imdb_link"] && data["imdb_link"].length > 0) ? `IMDb Link: ${data["imdb_link"]}\n` : "";
  descr += (data["directors"] && data["directors"].length > 0) ? `Directors: ${data["directors"].map(i => i["name"]).join(" / ")}\n` : "";
  descr += (data["creators"] && data["creators"].length > 0) ? `Creators: ${data["creators"].map(i => i["name"]).join(" / ")}\n` : "";
  descr += (data["actors"] && data["actors"].length > 0) ? `Actors: ${data["actors"].map(i => i["name"]).join(" / ")}\n` : "";
  descr += (data["description"] && data["description"].length > 0) ? `\nIntroduction\n    ${data["description"].replace(/\n/g, "\n" + "　".repeat(2))}\n` : "";

  data["format"] = descr.trim();
  data["success"] = true; // 更新状态为成功
  return makeJsonResponse(data);
}

async function gen_bangumi(sid) {
  let data = {
    site: "bangumi",
    sid: sid
  };

  // 请求页面
  let bangumi_link = `https://bgm.tv/subject/${sid}`;
  let [bangumi_page_resp, bangumi_characters_resp] = await Promise.all([
    fetch(bangumi_link),
    fetch(`https://bgm.tv/subject/${sid}/characters`)
  ]);

  let bangumi_page_raw = await bangumi_page_resp.text();

  if (bangumi_page_raw.match(/呜咕，出错了/)) {
    return makeJsonResponse(Object.assign(data, {
      error: NONE_EXIST_ERROR
    }));
  }

  data["alt"] = bangumi_link;
  let $ = page_parser(bangumi_page_raw);

  // 对页面进行划区
  let cover_staff_another = $("div#bangumiInfo");
  let cover_another = cover_staff_another.find("a.thickbox.cover");
  let staff_another = cover_staff_another.find("ul#infobox");
  let story_another = $("div#subject_summary");
  // let cast_another = $('div#browserItemList');

  /*  data['cover'] 为向前兼容项，之后均用 poster 表示海报
   *  这里有个问题，就是仍按 img.attr('src') 会取不到值因为 cf-worker中fetch 返回的html片段如下 ： https://pastebin.com/0wPLAf8t
   *  暂时不明白是因为 cf-worker 的问题还是 cf-CDN 的问题，因为直接源代码审查未发现该片段。
   */
  data["cover"] = data["poster"] = cover_another ? ("https:" + cover_another.attr("href")).replace(/\/cover\/[lcmsg]\//, "/cover/l/") : "";
  data["story"] = story_another ? story_another.text().trim() : "";
  data["staff"] = staff_another.find("li").map(function () {
    return $(this).text();
  }).get();

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
  // 读取第4-19x  （假定bgm的顺序为中文名、话数、放送开始、放送星期...，对新番适用，较老番组可能不好  ，staff从第四个 导演 起算）
  descr += (data["staff"] && data["staff"].length > 0) ? `[b]Staff: [/b]\n\n${data["staff"].slice(4, 4 + 15).join("\n")}\n\n` : "";
  // 读取前9项cast信息
  descr += (data["cast"] && data["cast"].length > 0) ? `[b]Cast: [/b]\n\n${data["cast"].slice(0, 9).join("\n")}\n\n` : "";
  descr += (data["alt"] && data["alt"].length > 0) ? `(来源于 ${data["alt"]} )\n` : "";

  data["format"] = descr.trim();
  data["success"] = true; // 更新状态为成功
  return makeJsonResponse(data);
}

async function gen_steam(sid) {
  let data = {
    site: "steam",
    sid: sid
  };

  let [steam_page_resp, steamcn_api_resp] = await Promise.all([
    fetch(`https://store.steampowered.com/app/${sid}/?l=schinese`, {
      headers: { // 使用Cookies绕过年龄检查和成人内容提示，并强制中文
        "Cookies": "lastagecheckage=1-January-1975; birthtime=157737601; mature_content=1; wants_mature_content=1; Steam_Language=schinese"
      }
    }),
    fetch(`https://steamdb.keylol.com/app/${sid}/data.js?v=38`)
  ]);

  let steam_page_raw = await steam_page_resp.text();

  // 不存在的资源会被302到首页，故检查标题
  if (steam_page_raw.match(/<title>(欢迎来到|Welcome to) Steam<\/title>/)) {
    return makeJsonResponse(Object.assign(data, {
      error: NONE_EXIST_ERROR
    }));
  }

  data["steam_id"] = sid;

  let steamcn_api_jsonp = await steamcn_api_resp.text();
  let steamcn_api_json = jsonp_parser(steamcn_api_jsonp);
  if (steamcn_api_json["name_cn"]) data["name_chs"] = steamcn_api_json["name_cn"];

  let $ = page_parser(steam_page_raw);

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
  return makeJsonResponse(data);
}

async function gen_indienova(sid) {
  let data = {
    site: "indienova",
    sid: sid
  };

  let indienova_page_resp = await fetch(`https://indienova.com/game/${sid}`);
  let indienova_page_raw = await indienova_page_resp.text();

  // 检查标题看对应资源是否存在
  if (indienova_page_raw.match(/出现错误/)) {
    return makeJsonResponse(Object.assign(data, {
      error: NONE_EXIST_ERROR
    }));
  }

  let $ = page_parser(indienova_page_raw);

  data["poster"] = data["cover"] = $("div.cover-image img").attr("src"); // 提出封面链接
  data["chinese_title"] = $("title").text().split("|")[0].split("-")[0].trim(); // 提出标题部分

  let title_field = $("div.title-holder"); // 提取出副标部分
  data["another_title"] = title_field.find("h1 small") ? title_field.find("h1 small").text().trim() : "";
  data["english_title"] = title_field.find("h1 span") ? title_field.find("h1 span").text().trim() : "";
  data["release_date"] = title_field.find("p.gamedb-release").text().trim();

  // 提取链接信息
  let link_field = $("div#tabs-link a.gamedb-link");
  if (link_field.length > 0) {
    let links = {};
    link_field.each(function () {
      let that = $(this);
      let site = that.text().trim();
      links[site] = that.attr("href");
    });
    data["links"] = links;
  }

  // 提取简介、类型信息
  let intro_field = $("#tabs-intro");
  data["intro"] = intro_field.find("div.bottommargin-sm").text().trim();

  let tt = intro_field.find("p.single-line");
  if (tt.length > 0) {
    data["intro_detail"] = tt.map(function () {
      return $(this).text().replace(/[ \n]+/ig, " ").replace(/,/g, "/").trim();
    }).get();
  }

  // 提取详细介绍 在游戏无详细介绍时用简介代替
  let descr_field = $("article");
  data["descr"] = descr_field.length > 0 ? descr_field.text().replace("……显示全部", "").trim() : data["intro"];

  // 提取评分信息
  let rating_field = $("div#scores text").map(function () {
    return $(this).text();
  }).get();
  data["rate"] = `${rating_field[0]}:${rating_field[1]} / ${rating_field[2]}:${rating_field[3]}`;

  // 提取制作与发行商
  let pubdev = $("div#tabs-devpub ul[class^=\"db-companies\"]");
  // noinspection JSUnusedLocalSymbols
  data["dev"] = pubdev.eq(0).text().trim().split("\n").map(function (value, index, array) {
    return value.trim();
  });
  // noinspection JSUnusedLocalSymbols
  data["pub"] = pubdev.length === 2 ? pubdev.eq(1).text().trim().split("\n").map(function (value, index, array) {
    return value.trim();
  }) : [];

  // 提取图片列表
  data["screenshot"] = $("li.slide img").map(function () {
    return $(this).attr("src");
  }).get();

  // 提取标签信息
  let cat_field = $("div.indienova-tags.gamedb-tags");
  let cat = cat_field ? cat_field.text().trim().split("\n").map(x => x.trim()) : [];
  // 对cat进行去重并移除 "查看全部 +"
  data["cat"] = cat.filter(function (item, pos) {
    return cat.indexOf(item) === pos && item !== "查看全部 +";
  });

  // 提取分级信息
  let level_field = $("h4:contains(\"分级\") + div.bottommargin-sm");
  data["level"] = level_field ? level_field.find("img").map(function () {
    return $(this).attr("src");
  }).get() : [];

  // 提取价格信息
  let price_fields = $("ul.db-stores");
  data["price"] = price_fields ? price_fields.find("li").map(function () {
    let price_field = $(this).find("a > div"); // 里面依次为3个div，分别为 store, platform , price
    let store = price_field.eq(0).text().trim();
    //let platform = price_field.eq(1).text().trim();  // 均为图片，无内容
    let price = price_field.eq(2).text().trim().replace(/[ \n]{2,}/, " ");
    return `${store}：${price}`;
  }).get() : [];

  // 生成format
  let descr = data["cover"] ? `[img]${data["cover"]}[/img]\n\n` : "";
  descr += "【基本信息】\n\n"; // 基本信息为原来的baseinfo块
  descr += (data["chinese_title"] && data["chinese_title"].length > 0) ? `中文名称：${data["chinese_title"]}\n` : "";
  descr += (data["english_title"] && data["english_title"].length > 0) ? `英文名称：${data["english_title"]}\n` : "";
  descr += (data["another_title"] && data["another_title"].length > 0) ? `其他名称：${data["another_title"]}\n` : "";
  descr += (data["release_date"] && data["release_date"].length > 0) ? `发行时间：${data["release_date"]}\n` : "";
  descr += (data["rate"] && data["rate"].length > 0) ? `评分：${data["rate"]}\n` : "";
  descr += (data["dev"] && data["dev"].length > 0) ? `开发商：${data["dev"].join(" / ")}\n` : "";
  descr += (data["pub"] && data["pub"].length > 0) ? `发行商：${data["pub"].join(" / ")}\n` : "";
  descr += (data["intro_detail"] && data["intro_detail"].length > 0) ? `${data["intro_detail"].join("\n")}\n` : "";
  descr += (data["cat"] && data["cat"].length > 0) ? `标签：${data["cat"].slice(0, 8).join(" | ")}\n` : "";
  if ((data["links"] && data["links"].length > 0)) {
    let format_links = [];
    for (let [key, value] of Object.entries(data["links"])) {
      format_links.push(`[url=${value}]${key}[/url]`);
    }
    descr += `链接地址：${format_links.join("  ")}\n`;
  }
  descr += (data["price"] && data["price"].length > 0) ? `价格信息：${data["price"].join(" / ")}\n` : "";
  descr += "\n";
  descr += (data["descr"] && data["descr"].length > 0) ? `【游戏简介】\n\n${data["descr"]}\n\n` : "";
  descr += (data["screenshot"] && data["screenshot"].length > 0) ? `【游戏截图】\n\n${data["screenshot"].map(x => `[img]${x}[/img]`).join("\n")}\n\n` : "";
  descr += (data["level"] && data["level"].length > 0) ? `【游戏评级】\n\n${data["level"].map(x => `[img]${x}[/img]`).join("\n")}\n\n` : "";

  data["format"] = descr.trim();
  data["success"] = true; // 更新状态为成功
  return makeJsonResponse(data);
}

async function gen_epic(sid) {
  let data = {
    site: "epic",
    sid: sid
  };

  let epic_api_resp = await fetch(`https://store-content.ak.epicgames.com/api/zh-CN/content/products/${sid}`);
  if ((await epic_api_resp.status) === 404) { // 当接口返回404时内容不存在，200则继续解析
    return makeJsonResponse(Object.assign(data, {
      error: NONE_EXIST_ERROR
    }));
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
  return makeJsonResponse(data);
}

async function makeIndexResponse() {
  return new Response(INDEX, {
    headers: {
      'Content-Type': 'text/html'
    },
  });
}

const INDEX = `
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <meta name="description" content="PT Gen">
    <meta name="author" content="Rhilip">
    <title>PT Gen</title>

    <link rel="icon" href="data:image/png;base64,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">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@3.3.7/dist/css/bootstrap.min.css" integrity="sha256-916EbMg70RQy9LHiGkXzG8hSg9EdNy97GazNG/aiY1w=" crossorigin="anonymous">

    <style type="text/css">
        body{padding-top:50px}
        .navbar-fixed-top{border:0}
        .main{padding:20px;margin-top:0}
        @media (min-width:768px){.main{padding-right:40px;padding-left:40px}}
        .zero-clipboard{position:relative}
        .btn-clipboard{position:absolute;top:8px;right:21px;z-index:10;display:block;padding:5px 8px;font-size:12px;color:#767676;cursor:pointer;background-color:#fff;border:1px solid #e1e1e8;border-radius:0 4px 0 4px}
        ul.timeline{list-style-type:none;position:relative}
        ul.timeline:before{content:' ';background:#d4d9df;display:inline-block;position:absolute;left:29px;width:2px;height:100%;z-index:400}
        ul.timeline>li{margin:20px 0;padding-left:20px}
        ul.timeline>li:before{content:' ';background:white;display:inline-block;position:absolute;border-radius:50%;border:3px solid #22c0e8;left:20px;width:20px;height:20px;z-index:400}
    </style>

    <!--[if lt IE 9]>
    <script src="https://cdn.jsdelivr.net/npm/html5shiv@3.7.3/dist/html5shiv.min.js" integrity="sha256-9uAoNWHdszsUDhSXf/rVcWOqKPfi5/8V5R4UdbZle2A=" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/respond.js@1.4.2/dest/respond.min.js" integrity="sha256-nwhzW/P9gnvWMPOm84MK8BzQRRMdi8iutxMuYsYcOgw=" crossorigin="anonymous"></script>
    <![endif]-->
</head>

<body>
<nav class="navbar navbar-inverse navbar-fixed-top">
    <div class="container-fluid">
        <div class="navbar-header">
            <button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#navbar"
                    aria-expanded="false" aria-controls="navbar">
                <span class="sr-only">Toggle navigation</span>
                <span class="icon-bar"></span>
                <span class="icon-bar"></span>
                <span class="icon-bar"></span>
            </button>
            <a class="navbar-brand" href="#">PT Gen</a>
        </div>
        <div id="navbar" class="navbar-collapse collapse">
            <ul class="nav navbar-nav navbar-right">
                <li><a href="//github.com/Rhilip/pt-gen-cfworker" target="_blank">Docs</a></li>
                <li><a href="//blog.rhilip.info" target="_blank">Powered By @Rhilip</a></li>
            </ul>
        </div>
    </div>
</nav>
<div class="container-fluid main">
    <div class="row">
        <div class="col-sm-8 col-sm-offset-2 col-md-6 col-md-offset-3">
            <div>
                <div class="form-inline">
                    <div class="form-group">
                        <label class="sr-only" for="input_value">Input value</label>
                        <input type="text" class="form-control"
                               placeholder="名称或豆瓣、IMDb、Bangumi、Steam、indienova、Epic等资源链接" id="input_value"
                               style="width: 480px"
                        />
                    </div>
                    <div class="form-group" id="search_source" style="display: none">
                        <label class="sr-only" for="search_source_val"></label>
                        <select class="form-control" id="search_source_val">
                            <option value="douban">豆瓣</option>
                            <option value="bangumi">Bangumi</option>
                        </select>
                    </div>
                    <button class="btn btn-success" id="query_btn">查询</button>
                </div>
            </div>
            <hr>
            <div id="gen_help" style="display: none"></div>
            <div id="gen_out">
                <div class="zero-clipboard">
                    <button class="btn btn-clipboard" data-clipboard-target="#movie_info">复制</button>
                </div>
                <textarea class="form-control" rows="22" id="movie_info"></textarea>
            </div>
            <hr>
            <div id="gen_replace">
                <h4>相关替代</h4>
                此处列出可以替代本平台的其他应用，以便在 <code>Pt-Gen</code> 失效或返回数据陈旧时使用
                <ul style="margin-top: 10px">
                    <li><b><a href="https://github.com/Rhilip/pt-gen-cfworker" target="_blank">Rhilip/pt-gen-cfworker</a></b>：构建在Cloudflare Worker上的Pt-Gen分支</li>
                    <li><b><a href="https://github.com/BFDZ/PT-Gen" target="_blank">BFDZ/Pt-Gen</a></b> :<a href="https://www.bfdz.ink/tools/ptgen" target="_blank">https://www.bfdz.ink/tools/ptgen</a> , 公开维护的Pt-Gen独立分支</li>
                    <li>豆瓣： <a href="https://greasyfork.org/en/scripts/38878" target="_blank">电影信息查询脚本</a> 或 <a href="https://greasyfork.org/scripts/329484" target="_blank">豆瓣资源下载大师</a></li>
                    <li>Bangumi： Bangumi Info Export <a href="https://git.io/fjm3l" target="_blank">脚本</a>，<a href="https://bgm.tv/dev/app/103" target="_blank">应用平台</a></li>
                </ul>
            </div>
            <div class="hidden"><span id="busuanzi_container_site_pv">本站总访问量<span id="busuanzi_value_site_pv"></span>次</span></div>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/jquery@1.12.4/dist/jquery.min.js" integrity="sha256-ZosEbRLbNQzLpnKIkEdrPv7lOy9C27hHQ+Xp8a4MxAQ=" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/clipboard@2.0.0/dist/clipboard.min.js" integrity="sha256-meF2HJJ2Tcruwz3z4XcxYDRMxKprjdruBHc3InmixCQ=" crossorigin="anonymous"></script>
<script async src="//busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js"></script>
<script>
  // 脚本查询相关
  $(function () {
    let query_btn = $("#query_btn");
    let gen_help = $("#gen_help");
    let gen_out = $("#gen_out");
    let movie_info = $("#movie_info");
    let input_btn = $("#input_value");
    let search_source = $("#search_source");

    input_btn.on('input change', function () {
      let input_value = input_btn.val();
      if (/^http/.test(input_value) || input_value === '') {
        query_btn.html("查询");
        search_source.hide();
        input_btn.css({width:'480px'});
      } else {
        query_btn.html("搜索");
        search_source.show();
        input_btn.css({width:'460px'});
      }
    });

    query_btn.disable = function () {
      query_btn.attr("disabled", true);
      query_btn.html("查询中");
    };

    query_btn.enable = function () {
      query_btn.removeAttr("disabled");
      query_btn.html("查询");
    };

    query_btn.click(function () {
      query_btn.disable();

      let input_value = input_btn.val();
      if (input_value.length === 0) {
        alert("空字符，请检查输入");
        query_btn.enable();
      } else if (/^http/.test(input_value)) {
        gen_help.hide();
        gen_out.show();

        $.getJSON('/', {
          url: input_value
        }).success(function (data) {
          movie_info.val(data["success"] === false ? data["error"] : data["format"]);
        }).fail(function (jqXHR) {
          alert(jqXHR.status === 429 ? 'Met Rate Limit, Retry later~' : "Error occured!");
        }).complete(function () {
          query_btn.enable();
        });
      } else if (input_btn.val().length > 0) {
        gen_help.show();
        gen_out.hide();

        $.getJSON('/', {
          search: input_value,
          source: $('#search_source_val').val()
        }).success(function (data) {
          let subjects = data.data;
          gen_help.html(subjects.reduce((accumulator, currentValue) => {
            return accumulator += "<tr><td>" + currentValue.year + "</td><td>" + currentValue.subtype + "</td><td>" + currentValue.title + "</td><td><a href='" + currentValue.link + "' target='_blank'>" + currentValue.link + "</a></td><td><a href='javascript:void(0);' class='gen-search-choose' data-url='" + currentValue.link + "'>选择</a></td></tr>";
          }, "<table id='gen_help_table' class='table table-striped table-hover'><thead><tr><th>年代</th><th>类别</th><th>标题</th><th>资源链接</th><th>行为</th></tr></thead><tbody>"));
          $("a.gen-search-choose").click(function () {
            let tag = $(this);
            input_btn.val(tag.attr("data-url"));
            query_btn.click();
          });
        }).fail(function (jqXHR) {
          alert('不知道发生了什么奇怪的事情');
        }).complete(function() {
          query_btn.enable();
        })
      }
    });
  });

  // 页面复制相关
  new ClipboardJS('.btn-clipboard');
</script>
</body>
</html>
`;
