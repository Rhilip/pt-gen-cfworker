# PT-Gen on Cloudflare Worker
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2FRhilip%2Fpt-gen-cfworker.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2FRhilip%2Fpt-gen-cfworker?ref=badge_shield)


基于 [BFDZ/Pt-Gen v0.4.7](https://github.com/BFDZ/PT-Gen/commit/950b85de16d9532e847a0756f165d1b29f09dd31) 改写，
使之可以直接在Cloudflare Worker上使用。

## 支持资源链接

| 资源来源 | 链接格式（Regexp） |
| :---: | :------|
| douban | `/(?:https?:\/\/)?(?:(?:movie\|www)\.)?douban\.com\/(?:subject\|movie)\/(\d+)\/?/` |
| imdb | `/(?:https?:\/\/)?(?:www\.)?imdb\.com\/title\/(tt\d+)\/?/` |
| bangumi | `/(?:https?:\/\/)?(?:bgm\.tv\|bangumi\.tv\|chii\.in)\/subject\/(\d+)\/?/` |
| steam | `/(?:https?:\/\/)?(?:store\.)?steam(?:powered\|community)\.com\/app\/(\d+)\/?/` |
| indienova | `/(?:https?:\/\/)?indienova\.com\/game\/(\S+)/` | 
| epic | `/(?:https?:\/\/)?www\.epicgames\.com\/store\/[a-z]{2}-[A-Z]{2}\/product\/(\S+)\/\S?/` |


## License
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2FRhilip%2Fpt-gen-cfworker.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2FRhilip%2Fpt-gen-cfworker?ref=badge_large)