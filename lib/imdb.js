import {NONE_EXIST_ERROR, page_parser} from "./common";

function getNumberFromString(raw) {
  return (raw.match(/[\d,]+/) || [0])[0].replace(/,/g, "");
}

export async function search_imdb(query) {
  query = query.toLowerCase()  // 大写字母须转成小写
  let imdb_search = await fetch(`https://v2.sg.media-imdb.com/suggestion/${query.slice(0, 1)}/${query}.json`)
  let imdb_search_json = await imdb_search.json();
  return {
    data: (imdb_search_json.d || []).filter(d => {
      return /^tt/.test(d.id)
    }).map(d => {
      return {
        year: d.y,
        subtype: d.q,
        title: d.l,
        link: `https://www.imdb.com/title/${d.id}`
      }
    })
  }
}

export async function gen_imdb(sid) {
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

  let imdb_page_resp = await fetch(imdb_url);
  let imdb_page_raw = await imdb_page_resp.text();

  if (imdb_page_raw.match(/404 Error - IMDb/)) {
    return Object.assign(data, {
      error: NONE_EXIST_ERROR
    });
  }

  let imdb_release_info_page_req = fetch(`${imdb_url}releaseinfo`)

  let $ = page_parser(imdb_page_raw);

  // 首先解析页面中的json信息，并从中获取数据  `<script type="application/ld+json">...</script>`
  let page_json = JSON.parse($('script[type="application/ld+json"]').html().replace(/\n/ig, ''));

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

  data["keywords"] = "keywords" in page_json ? page_json["keywords"].split(",") : [];
  let aggregate_rating = page_json["aggregateRating"] || {};

  data["imdb_votes"] = aggregate_rating["ratingCount"] || 0;
  data["imdb_rating_average"] = aggregate_rating["ratingValue"] || 0;
  data["imdb_rating"] = `${data["imdb_rating_average"]}/10 from ${data["imdb_votes"]} users`;

  // 解析页面元素
  // 第一部分： Metascore，Reviews，Popularity
  let next_data_json = JSON.parse($('script#__NEXT_DATA__').html().replace(/\n/ig, ''));
  let total_data = {};
  if ("props" in next_data_json && "urqlState" in next_data_json["props"]) {
    for (const [_, value] of Object.entries(next_data_json["props"]["urqlState"])) {
      if ("data" in value && "title" in value["data"] && value["data"]["title"]["id"] === imdb_id) {
        total_data = {...total_data, ...value["data"]["title"]};
      }
    }
  }
  total_data = Object.fromEntries(Object.entries(total_data).filter(([_, value]) => value !== null));
  if ("metacritic" in total_data && "metascore" in total_data["metacritic"] && "score" in total_data["metacritic"]["metascore"])
    data["metascore"] = total_data["metacritic"]["metascore"]["score"];
  if ("reviews" in total_data && "total" in total_data["reviews"])
    data["reviews"] = total_data["reviews"]["total"];
  if ("criticReviewsTotal" in total_data && "total" in total_data["criticReviewsTotal"])
    data["critic"] = total_data["criticReviewsTotal"]["total"];
  if ("meterRanking" in total_data && "currentRank" in total_data["meterRanking"])
    data["popularity"] = total_data["meterRanking"]["currentRank"];

  // 第二部分： Details
  let details_another = $("section[cel_widget_id='StaticFeature_Details']");
  let title_anothers = details_another.find("li.ipc-metadata-list__item");
  let details_dict = {};
  title_anothers.each(function () {
    let label_tag = $(this).find(".ipc-metadata-list-item__label");
    let values = $(this).find(".ipc-metadata-list-item__list-content-item");

    if (values.length > 0) {
      let extracted_values = [];
      values.each(function () {
        const current_element = $(this);

        if (current_element.attr("href") && current_element.attr("href").startsWith("http")) {
          extracted_values.push(`${current_element.text()} - ${current_element.attr("href")}`);
        } else {
          extracted_values.push(current_element.text());
        }
      });
      details_dict[label_tag.text()] = extracted_values;
    }
  });
  data["details"] = details_dict;

  // 请求附属信息
  // 第一部分： releaseinfo
  let imdb_release_info_page_resp = await imdb_release_info_page_req;
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
  return data;
}
