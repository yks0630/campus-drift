# 极速热场 · 校园漂移赛

60 秒手机竖屏体感赛车，配套主持台和横屏实时排名。车辆、道路、障碍、按钮和粒子贴图采用 Kenney 原版 CC0 素材。

## 使用入口

- 首页：`/`
- 单人试驾：`/?practice=1`
- 创建比赛：`/?mode=host`
- 主持台：`/?host=六位房间号`，主持凭证只保存在创建房间的浏览器本地，不放入 URL。
- 玩家入口：`/?room=六位房间号`
- 纯大屏：`/?screen=六位房间号`

主持台创建房间后显示参赛二维码。玩家加入、选择赛车，开启体感并校准握姿。至少一位玩家加入后，主持人可以统一发车；倒计时 5 秒，正式比赛 60 秒，随后有 5 秒网络成绩同步时间。结算后可导出全部成绩、保留参赛者再来一局。

手机左右倾斜转向，左下按住漂移，右下按住加速；两个键可同时按住。体感不可用时支持触控方向键。电脑支持左右方向键、向上键/空格加速、Shift 漂移。

## 已实现规则

- 不按加速时，正常车速逐渐趋近 30 码：低于 30 自动提高，高于 30 逐渐回落。
- 按住加速，正常车速逐渐增加至 120；从静止到 120 约 8 秒。
- 氮气对持续变化的正常车速乘 1.3，保持 3 秒，再用 2 秒消退；普通最高速度 120，氮气最高 156。
- 再次吃到氮气刷新满额 3 秒，不继续叠加倍率。
- 障碍减速 50%，持续 3 秒；与氮气同时生效，同类障碍刷新时间。
- 30 是正常巡航目标，不是道具作用后的最低实际车速。
- 漂移提高转向灵敏度并减速 8%；驶出赛道也会减速。
- 所有人使用相同的赛道对象序列。赛车之间不碰撞，按沿赛道累计前进距离排名。
- 服务端重放玩家的操作输入，统一计算道具碰撞和距离，不接受客户端上报的距离分数。
- 断线后自动重连、补交已记录的操作；最终同步窗口结束后，未收到的操作按最后输入最多保持 1 秒，再转为正常巡航结算。

## 本地运行

需要 Node.js 22.13 或以上版本。依赖版本锁定在 package-lock.json。

```bash
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_youthful_iron_monger.sql
npm start -- --port 5173
```

迁移只需在新数据库执行一次，后续启动不用重放。需要热更新时可改用 `npm run dev -- --port 5173`。

手机体感正式使用需要 HTTPS。localhost 二维码仅供本机测试，不能用于现场其他手机；现场应使用发布后的公网 HTTPS 地址。

## 验证结果（2026-11-04）

- TypeScript 检查和生产构建通过。
- 5 项规则与服务集成测试通过：巡航/加速、氮气与障碍叠加及消退、氮气刷新、重复碰撞与重放、100 人完整比赛与权限/容量/时钟/轮次校验。
- 实际 HTTP 联调使用本机生产构建的 Cloudflare Worker + 本地 D1：100 个车手、60 秒、12,202 次请求，0 错误；延迟中位数 206.3 ms，P95 为 352.2 ms。详见 `tests/http-load-result.json`。
- 浏览器实际验证：入场、统一发车、键盘驾驶、服务端排名同步、60 秒结算、最终距离一致、CSV 成绩下载，以及 390×844 手机与 1280×800 横屏布局。
- 未完成的现场验证：真实手机传感器、移动信号、公网部署地域延迟及 100 台实机同时参与。本机模拟不能证明这些项目已经通过。

运行规则测试：

```bash
node --test --test-isolation=none tests/race.test.ts
```

本地服务启动后可运行 `python tests/http-load.py`，它会创建独立测试房间并进行约 70 秒的本机接口联调，不向公网压测。

## UI 参考与素材

驾驶 HUD 参考 Asphalt Legends UNITE 实机截图中的大号速度数字、紧凑排位/计时和氮气反馈；按手机竖屏改排版。参考页面：https://meridiem-games.com/en/game/asphalt-legends-unite 。该截图只用于设计参考，没有作为游戏素材打包。

游戏素材来源：

- Racing Pack：https://kenney.nl/assets/racing-pack
- UI Pack 2.0（含 Kenney Future Narrow 字体）：https://kenney.nl/assets/ui-pack
- Particle Pack：https://kenney.nl/assets/particle-pack

原始许可保存在 `public/assets/*-LICENSE.txt`。赛道用原始道路图片逐行弯曲渲染，赛车、树木、障碍、按钮、烟雾、火焰和火花均采用下载资源。

## 发布状态

Sites 项目 ID 保存在 `.openai/hosting.json`。发布后的访问权限以 Sites 控制台返回值为准；私有试玩站不能直接作为全体学生免登录入口。不要将浏览器的本地主持凭证发送给参赛者。
