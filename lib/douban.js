import {jsonp_parser, NONE_EXIST_ERROR, page_parser} from "./common";

/* global DOUBAN_COOKIE */

let fetch_init = {}
if (globalThis['DOUBAN_COOKIE']) {
  fetch_init = {headers: {"Cookie": DOUBAN_COOKIE}}
}

export async function search_douban(query) {
  let douban_search = await fetch(`https://movie.douban.com/j/subject_suggest?q=${query}`, fetch_init);
  let douban_search_json = await douban_search.json();

  return {
    data: douban_search_json.map(d => {
      return {
        year: d.year,
        subtype: d.type,
        title: d.title,
        subtitle: d.sub_title,
        link: `https://movie.douban.com/subject/${d.id}/`
      }
    })
  }
}

export async function gen_douban(sid) {
  let data = {
    site: "douban",
    sid: sid
  };

  // 下面开始正常的豆瓣处理流程
  let douban_link = `https://movie.douban.com/subject/${sid}/`;  // 构造链接
  let db_page_resp = await fetch(douban_link, fetch_init); // 请求豆瓣对应项目主页面
  let douban_page_raw = await db_page_resp.text();

  // 对异常进行处理
  if (douban_page_raw.match(/你想访问的页面不存在/)) {
    return Object.assign(data, {
      error: NONE_EXIST_ERROR
    });
  } else if (douban_page_raw.match(/检测到有异常请求/)) { // 真的会有这种可能吗？
    return Object.assign(data, {
      error: "GenHelp was temporary banned by Douban, Please wait...."
    });
  } else {
    let awards_page_req = fetch(`${douban_link}awards`, fetch_init) // 马上请求豆瓣获奖界面

    // 解析主页面
    let $ = page_parser(douban_page_raw);

    let title = $("title").text().replace("(豆瓣)", "").trim();

    // 从ld+json中获取原来API返回的部分信息
    let ld_json = JSON.parse($('head > script[type="application/ld+json"]').html().replace(/(\r\n|\n|\r|\t)/gm, ''));

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
    let imdb_api_req;
    let imdb_anchor = $('#info span.pl:contains("IMDb")');
    if (imdb_anchor.length > 0) {
      data["imdb_id"] = imdb_id = fetch_anchor(imdb_anchor);
      data["imdb_link"] = imdb_link = `https://www.imdb.com/title/${imdb_id}/`
      imdb_api_req = fetch(`https://p.media-imdb.com/static-content/documents/v1/title/${imdb_id}/ratings%3Fjsonp=imdb.rating.run:imdb.api.title.ratings/data.json`);
    }

    let chinese_title = data["chinese_title"] = title;
    let foreign_title = data["foreign_title"] = $('span[property="v:itemreviewed"]').text().replace(data["chinese_title"], "").trim();

    let aka_anchor = $('#info span.pl:contains("又名")');
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

    let regions_anchor = $('#info span.pl:contains("制片国家/地区")'); //产地
    let language_anchor = $('#info span.pl:contains("语言")'); //语言
    let episodes_anchor = $('#info span.pl:contains("集数")'); //集数
    let duration_anchor = $('#info span.pl:contains("单集片长")'); //片长

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

    // 简介 首先检查是不是有隐藏的，如果有，则直接使用隐藏span的内容作为简介，不然则用 span[property="v:summary"] 的内容
    // 20221201 issue#34 豆瓣将上一层div的id从 link-report 变为 link-report-intra
    let introduction_another = $('#link-report-intra > span.all.hidden, #link-report-intra > [property="v:summary"], #link-report > span.all.hidden, #link-report > [property="v:summary"]')
    data["introduction"] = introduction = (
      introduction_another.length > 0 ? introduction_another.text() : '暂无相关剧情介绍'
    ).split('\n').map(a => a.trim()).filter(a => a.length > 0).join('\n');  // 处理简介缩进

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
      data["tags"] = tags = tag_another.map(function () {
        return $(this).text()
      }).get();
    }

    let awards_page_resp = await awards_page_req;
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

    if (imdb_api_req) {
      let imdb_api_resp = await imdb_api_req;
      let imdb_api_raw = await imdb_api_resp.text();
      let imdb_json = jsonp_parser(imdb_api_raw);

      if (imdb_json["resource"]) {
        data["imdb_rating_average"] = imdb_average_rating = imdb_json["resource"]["rating"] || 0;
        data["imdb_votes"] = imdb_votes = imdb_json["resource"]["ratingCount"] || 0;
        data["imdb_rating"] = imdb_rating = `${imdb_average_rating}/10 from ${imdb_votes} users`;
      }
    }

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
    return data;
  }
}
