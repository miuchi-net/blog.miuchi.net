# blog.miuchi.net

`https://fuku.day/blog/rss.xml`、`https://blog.momee.mt/rss.xml`、`https://www.abap34.com/rss.xml` をまとめて表示する静的ブログポータルです。

## Development

```sh
npm ci
npm run build
```

`dist/index.html` が生成されます。GitHub Actions は毎日 03:00 JST に RSS を取得して GitHub Pages へデプロイします。
