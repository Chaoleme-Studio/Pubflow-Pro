# PubFlow 版本发布 SOP

根目录 `CHANGELOG.md` 永远只保存当前准备发布的版本，GitHub Release workflow 固定读取这个文件。历史版本归档在本目录中，因此发布新版本时不需要修改 `.github/workflows/release.yml`。

## 1. 确定版本

版本使用完整 SemVer，例如 `1.3.0`；Git 标签固定加小写 `v`，例如 `v1.3.0`。

## 2. 归档上一版本

确认上一版本的根 `CHANGELOG.md` 已保存为：

```text
Changelog/v<上一版本>.md
```

已经归档时不要重复修改历史文件。

## 3. 更新当前版本

1. 将 `pubflow-Pro/package.json` 的 `version` 改为 `<新版本>`。
2. 用当前版本完整发布说明替换根 `CHANGELOG.md`。
3. 根文件必须包含以下标题，供发布校验读取：

```markdown
## [<新版本>] - YYYY-MM-DD
```

如果根文件采用发布页样式标题，也必须另外保留上述机器可读版本标题。

4. 将同一版完整说明保存到：

```text
Changelog/v<新版本>.md
```

构建出的 manifest 会自动读取 `package.json` 版本，无需手动修改。

## 4. 本地校验与构建

```bash
cd pubflow-Pro
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build:protected
pnpm verify:release -- --tag v<新版本>
```

正式本地产物使用仓库根目录脚本：

```bash
ENV=production ./scripts/build-extension.sh
```

确认生成：

```text
dist/extension/pubflow-extension.zip
```

## 5. 提交与发布

```bash
git add pubflow-Pro/package.json CHANGELOG.md Changelog/
git commit -m "chore(release): bump version to <新版本>"
git tag v<新版本>
git push origin main --tags
```

推送标签后，现有 Release workflow 会自动构建三个模块、以根 `CHANGELOG.md` 作为 Release 正文，并上传扩展 ZIP。不要为单个版本修改 `body_path` 或附件路径。

## Checklist

- [ ] `pubflow-Pro/package.json` 为 `<新版本>`
- [ ] 根 `CHANGELOG.md` 只包含当前版本说明，并含机器可读版本标题
- [ ] `Changelog/v<新版本>.md` 已归档
- [ ] `pnpm verify:release -- --tag v<新版本>` 通过
- [ ] 标签为 `v<新版本>`

> `pubflow-Pro-server-axum-starter/migration/Cargo.toml` 的版本是 Rust migration crate 内部版本，不跟随扩展版本更新。
