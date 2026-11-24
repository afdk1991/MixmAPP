<template>
  <view class="page" :class="{ 'page--gate': gate }">
    <mx-bar v-if="!gate" title="隐私政策" />

    <view class="head">
      <text class="eyebrow">PRIVACY &amp; PERMISSIONS</text>
      <text class="title">隐私政策与权限说明</text>
      <text class="sub mono">版本 {{ policyVersion }} · 更新于 2026-11-24 · 上一版 2026-11-15</text>
      <view class="rule" />
    </view>

    <!-- ===== 本版变更 ===== -->
    <view class="sec sec--change">
      <text class="sec-name">本版变更要点</text>
      <text class="para">1. 新增「二、设备与网络信息」：逐字段披露设备标识、机型、系统版本、IP、网络类型、运营商、采集时间的来源、用途与可见范围。</text>
      <text class="para">2. 新增「三、IP 地址的产生方式与限制」：IP 由服务端在请求到达时记录，并如实说明当前实现取转发头首跳、存在被伪造的可能。</text>
      <text class="para">3. 收集清单改为表格，补入支付流水与运行日志两组。</text>
      <text class="para">4. 权限清单按安装包实测重写：修正上一版「不申请位置」的表述——填写收货地址时可选调用，且 App 内当前不可用。</text>
      <text class="para">5. 新增信息的可见范围、分项保存期限、未成年人保护、安全事件通知、政策变更与生效、联系方式。</text>
    </view>

    <!-- ===== 一、收集清单（表格） ===== -->
    <view class="sec">
      <text class="sec-name">一、我们收集什么</text>
      <text class="para">下表为当前版本的全部收集项。表格里不出现的内容，本应用不收集。</text>
      <view class="tbl">
        <view class="tbl-head">
          <text class="th c1">字段</text>
          <text class="th c2">来源</text>
          <text class="th c3">用途</text>
          <text class="th c4">必需</text>
          <text class="th c5">期限</text>
        </view>
        <view v-for="row in collectionRows" :key="row.field" class="tbl-row">
          <text class="td c1">{{ row.field }}</text>
          <text class="td c2">{{ row.source }}</text>
          <text class="td c3">{{ row.purpose }}</text>
          <text class="td c4">{{ row.required }}</text>
          <text class="td c5">{{ row.keep }}</text>
        </view>
      </view>
      <text class="para para--note">「必需」指不提供即无法完成对应功能；标「可选」的项不提供不影响其他功能。</text>
    </view>

    <!-- ===== 二、设备与网络信息（新增专节） ===== -->
    <view class="sec">
      <text class="sec-name">二、设备与网络信息</text>
      <text class="para">登录状态下，应用会上报一次「设备与网络快照」。逐字段说明如下。</text>
      <view class="prow">
        <text class="prow-k mono">设备标识</text>
        <text class="prow-v">Android 应用取系统分配给本应用的 ANDROID_ID；取不到时改用本机首次生成的持久随机串。网页与小程序使用保存在本地的随机 UUID。用途：同一账号识别不同设备、游客账号在同一设备复用、异常登录识别。不用于广告追踪——当前版本未接入任何广告或统计 SDK。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">机型 / 系统名 / 系统版本</text>
        <text class="prow-v">Android 读取系统属性；网页端从浏览器 User-Agent 尽力解析，解析不到留空，不填假值。用途：故障定位与兼容性排查。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">网络类型</text>
        <text class="prow-v">Wi-Fi / 移动网络 / 以太网 / 未连接。取不到一律记为「未连接」，不猜测。用途：区分网络问题与账号问题。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">运营商</text>
        <text class="prow-v">仅 Android 原生壳可读取运营商名称；网页与小程序取不到时留空。用途：判断网络侧故障。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">IP 地址</text>
        <text class="prow-v">只由服务端产生，客户端上报的同名字段一律丢弃（见第三节）。用途：异常登录识别与安全审计。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">采集时间</text>
        <text class="prow-v">取服务端写入时间，不采信客户端上报的时间。用途：判断快照新鲜度。</text>
      </view>
      <text class="para">写入位置：每个账号、每台设备仅保留最近一条快照；登录令牌记录中同时保存该次登录的设备快照；运营后台的写操作审计另记操作者 IP 与浏览器标识。</text>
      <text class="para">可见范围：仅在「星际联邦通行证 → 设备与网络」与「关于与能力 → 本机信息」向本人展示，以及运营后台的「用户最近会话」向已登录的管理员展示。不进入任何公开页面，不对外提供，不用于广告投放。</text>
    </view>

    <!-- ===== 三、IP 口径 ===== -->
    <view class="sec">
      <text class="sec-name">三、IP 地址的产生方式与限制</text>
      <text class="para">IP 由服务端在请求到达时记录，客户端无法指定。当前实现读取反向代理转发头（X-Forwarded-For）的第一跳，转发头缺失时回落到建立连接的直连地址。</text>
      <text class="para">需要说明的限制：转发头由请求方携带，可被伪造。也就是说，在有人刻意构造请求的情况下，当前记录的 IP 可能不等于真实来源。我们正在改为只取直连地址；在改造完成前，IP 只作为辅助线索，不作为限制账号的唯一依据。</text>
      <text class="para">日志中的 IP 与设备号均做脱敏：IPv4 只保留前两段、IPv6 只保留前两组，设备号只保留前 6 位。</text>
    </view>

    <!-- ===== 四、权限（原第二节，实测重写） ===== -->
    <view class="sec">
      <text class="sec-name">四、应用申请的权限</text>
      <view class="perm">
        <text class="perm-k mono">网络 · 必需</text>
        <text class="perm-v">访问网络与读取网络状态。用于加载页面、上报设备快照、断网时给出提示并自动重试。</text>
      </view>
      <view class="perm">
        <text class="perm-k mono">通知 · 可选</text>
        <text class="perm-v">安装包已声明通知权限，但当前版本启动时不主动弹出授权框，也没有启用推送通道；未授权不影响任何功能。</text>
      </view>
      <view class="perm">
        <text class="perm-k mono">剪贴板 · 可选</text>
        <text class="perm-v">仅在你点击「复制设备号」「复制订单编号」等按钮时写入，代码中没有任何读取剪贴板的调用。</text>
      </view>
      <view class="perm">
        <text class="perm-k mono">位置 · 可选</text>
        <text class="perm-v">仅在购物车填写收货地址、点击「定位填充」时由你主动触发，用于回填省市区；不点击则不调用，也不在后台定位。Android 安装包当前未声明定位权限，因此在 App 内该按钮会提示「定位不可用，请手动填写」；小程序端声明了位置用途，且地图服务当前未启用。不使用该功能不影响下单。</text>
      </view>
      <text class="para">按安装包实测，本应用只申请网络、网络状态与通知三项权限，不申请相机、麦克风、通讯录、存储读写、短信、通话记录、日历与身体传感器权限。以上清单与 Android 安装包声明逐条对应；小程序端另按平台要求声明位置用途。</text>
    </view>

    <!-- ===== 五、使用（原第三节） ===== -->
    <view class="sec">
      <text class="sec-name">五、信息如何使用</text>
      <text class="para">1. 提供账号、商城、订单与售后功能。</text>
      <text class="para">2. 账号安全：识别异常登录、区分设备、发现同一设备上的异常行为。</text>
      <text class="para">3. 故障定位：依据设备与网络快照、脱敏日志复现并修复问题。</text>
      <text class="para">4. 合规留痕：记录隐私政策的同意版本、时间与环节。</text>
      <text class="para">以下三件事我们不做，且可以核验：不接入广告、统计或用户画像 SDK；不向第三方出售或出租个人信息；不在后台读取剪贴板内容。</text>
    </view>

    <!-- ===== 六、第三方（原第四节扩写） ===== -->
    <view class="sec">
      <text class="sec-name">六、第三方与委托处理</text>
      <text class="para">当前版本，短信验证码、一键登录、地图、推送、AI、对象存储与支付渠道均处于未启用或开发态：短信验证码由服务端控制台输出，不发生对外短信发送；地图、推送、AI 与服务端存储为开发态实现；微信支付与支付宝均未启用。未启用时不向任何第三方传输个人信息。</text>
      <text class="para">某能力启用后，我们将按下列原则委托处理，并在本页更新受托方名称、处理目的与字段范围后再生效：仅传输完成该功能所必需的最小字段；签署数据处理约定；要求受托方不得超范围使用；涉及跨境传输的，另行告知并取得同意。</text>
      <text class="para">页面所用的 JS、CSS 与图片由自有服务器提供；页面加载约 3 秒后，uni-app 框架默认样式会向 DCloud 官方 CDN 请求两张阴影预载图片，该请求只带图片地址、不携带账号或设备信息。除此之外不加载第三方统计、广告或热更新 SDK。站外链接由系统浏览器打开，适用该网站自己的隐私政策。</text>
    </view>

    <!-- ===== 七、可见范围 ===== -->
    <view class="sec">
      <text class="sec-name">七、谁能看到你的信息</text>
      <text class="para">本人：在「我的」「订单」「收藏」「购物车」「关于与能力」等页面查看自己的资料、订单与设备快照。</text>
      <text class="para">运营人员：仅在后台登录后，按单个用户查看账号概览、订单、收藏数量与最近会话摘要（最多 10 条）。后台入口需要独立的令牌或会话，未登录时相关接口一律返回 404，不暴露接口是否存在。</text>
      <text class="para">公众：任何页面都不展示他人的手机号、邮箱、设备标识或 IP。商品与订单信息只在本人视图出现。</text>
    </view>

    <!-- ===== 八、保存期限与安全（原第五节扩写） ===== -->
    <view class="sec">
      <text class="sec-name">八、保存期限与安全</text>
      <view class="prow">
        <text class="prow-k mono">登录凭证</text>
        <text class="prow-v">刷新凭证自签发起 30 天到期，退出登录即在本机清除；服务端只保存凭证的哈希，不保存原文。应用已关闭系统自动备份，避免凭据随设备迁移被带出。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">设备与网络快照</text>
        <text class="prow-v">每账号每设备仅保留最近一次，新快照覆盖旧快照；当前没有自动清除任务，账号注销时随账号数据一并删除。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">同意记录</text>
        <text class="prow-v">本机记录与账号记录同步保存，用于证明同意发生在何时、哪个版本；随账号存续保留。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">订单与收货信息</text>
        <text class="prow-v">为履约、售后与对账长期保留，当前没有自动清理任务。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">运行日志</text>
        <text class="prow-v">服务端访问日志写入容器标准输出，其中 IP 与设备号已脱敏；保留天数由部署环境的日志轮转设置决定，仓库内没有固定天数配置。</text>
      </view>
      <text class="para">安全措施：全站 HTTPS；密码仅保存哈希；后台会话 Cookie 设置为不可被脚本读取、仅同站发送；后台令牌与会话校验失败一律返回 404。</text>
    </view>

    <!-- ===== 九、你的权利（原第六节扩写） ===== -->
    <view class="sec">
      <text class="sec-name">九、你的权利</text>
      <view class="prow">
        <text class="prow-k mono">查阅</text>
        <text class="prow-v">「星际联邦通行证」页可查看账号资料、设备与网络信息；「订单」「收藏」「购物车」页可查看对应数据；「关于与能力」页可查看本机信息与服务端能力状态。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">复制</text>
        <text class="prow-v">设备号与订单编号旁提供「复制」按钮，可把数据带走留存。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">更正</text>
        <text class="prow-v">昵称、用户名、密码可在「星际联邦通行证」页修改；收货地址可在购物车页新增、编辑、删除。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">删除</text>
        <text class="prow-v">收藏、购物车条目与收货地址可在对应页面直接删除；本地缓存可在系统设置中清除应用数据。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">注销账号</text>
        <text class="prow-v">应用内目前没有自助注销入口。如需删除账号及其数据，请通过下方联系方式提出，我们在核实身份后处理；处理范围包括账号资料、订单与收货信息、设备快照与登录凭证。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">撤回同意</text>
        <text class="prow-v">退出登录并清除应用数据即可撤回本机同意；撤回后仍可浏览部分页面，但无法使用账号、下单与订单功能。注册时未勾选同意则不会创建账号。</text>
      </view>
      <view class="prow">
        <text class="prow-k mono">投诉举报</text>
        <text class="prow-v">可通过下方公开仓库的 issue 渠道提交；涉及备案主体的投诉，可按页脚备案号在工信部备案系统查询主体后向监管部门反映。</text>
      </view>
    </view>

    <!-- ===== 十、未成年人 ===== -->
    <view class="sec">
      <text class="sec-name">十、未成年人保护</text>
      <text class="para">本应用不面向未满 14 周岁的儿童单独提供服务。当前版本未设置年龄校验环节；如你是未成年人，应在监护人的同意和指导下使用，并由监护人阅读本政策。监护人如发现未成年人未经同意提交了信息，可通过下方联系方式要求删除。</text>
    </view>

    <!-- ===== 十一、事件通知 ===== -->
    <view class="sec">
      <text class="sec-name">十一、信息安全事件通知</text>
      <text class="para">如发生个人信息泄露、篡改或丢失，我们会评估影响范围，通过本页公告与应用内提示告知受影响的用户，并按法律要求向监管部门报告。当前版本未启用推送通道，因此通知以页面公告为准。</text>
    </view>

    <!-- ===== 十二、变更与生效 ===== -->
    <view class="sec">
      <text class="sec-name">十二、政策变更与生效</text>
      <text class="para">本政策自 2026-11-24 起生效。发生实质变更（新增收集项、扩大用途、新增受托方）时，我们会升级页首版本号，旧版本的同意记录随即失效，并在注册环节要求重新勾选同意；本页顶部同时保留上一版日期与本版变更要点。</text>
      <text class="para">当前同意环节设在注册提交前。已登录的老用户不会在启动时被强制拦截，但每次进入本页看到的都是最新版本；如监管或应用商店要求启动即展示，我们会把同意环节前移到启动时。</text>
    </view>

    <!-- ===== 十三、联系 ===== -->
    <view class="sec">
      <text class="sec-name">十三、联系我们</text>
      <text class="para">运营主体：以 ICP 备案登记主体为准，备案号为 苏ICP备2025161175号-2，主体名称与统一社会信用代码可在工信部备案系统按该备案号查询（本站页脚提供备案链接）。公安备案号为 苏公网安备32072202010511号。</text>
      <text class="para">开发者反馈渠道：公开仓库 issue（github.com/afdk1991/MixmAPP/issues）。应用内暂未提供在线客服或邮箱入口，涉及账号与数据的请求请注明账号编号，以便核对。</text>
      <text class="para">我们会在收到请求并完成身份核实后处理；涉及删除账号的请求，处理完成后本机登录状态失效。</text>
    </view>

    <view v-if="gate" class="mx-sticky-bar gate-bar">
      <view class="btn btn--quiet btn--sm gate-decline" hover-class="is-press" @tap="decline">
        <text class="btn-text btn-text--dark">暂不同意</text>
      </view>
      <view class="btn btn--deep gate-agree" hover-class="is-press" @tap="agree">
        <text class="btn-text">同意并继续</text>
      </view>
    </view>
    <text v-else class="tail mono">本页为最新版本 · 版本号 {{ policyVersion }}</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { ROUTES } from '../../routes';
import { PRIVACY_POLICY_VERSION, recordPrivacyConsent } from '../../privacy';

/** gate = 首启同意模式（无返回栏、底部固定同意条）；否则为回看模式 */
const gate = ref(false);
const policyVersion = PRIVACY_POLICY_VERSION;

/** 收集清单：字段 / 来源 / 用途 / 是否必需 / 保存期限。改这里即可整页同步。 */
type CollectionRow = {
  field: string;
  source: string;
  purpose: string;
  required: string;
  keep: string;
};

const collectionRows: CollectionRow[] = [
  {
    field: '用户名 / 昵称 / 手机号 / 邮箱',
    source: '你填写或第三方登录返回',
    purpose: '账号识别与登录',
    required: '必需',
    keep: '至账号注销',
  },
  {
    field: '密码',
    source: '你填写',
    purpose: '登录鉴权',
    required: '可选',
    keep: '仅存哈希，至账号注销',
  },
  {
    field: '第三方登录标识',
    source: '授权登录时由渠道返回',
    purpose: '绑定账号、避免重复注册',
    required: '用该方式登录时必需',
    keep: '至账号注销',
  },
  {
    field: '隐私同意版本 / 时间 / 环节',
    source: '你勾选同意时产生',
    purpose: '合规留痕',
    required: '必需',
    keep: '随账号存续',
  },
  {
    field: '收货人 / 手机号 / 省市区 / 详址',
    source: '你填写',
    purpose: '发货与售后',
    required: '下单时必需',
    keep: '长期（无自动清理）',
  },
  {
    field: '订单号 / 商品 / 金额 / 状态',
    source: '下单与支付产生',
    purpose: '履约、售后、对账',
    required: '必需',
    keep: '长期（无自动清理）',
  },
  {
    field: '购物车 / 收藏 / 浏览记录',
    source: '你在应用内操作产生',
    purpose: '保留你的选择',
    required: '可选',
    keep: '可随时删除',
  },
  {
    field: '支付渠道单号 / 金额 / 状态 / 回调报文',
    source: '支付时由渠道与服务端产生',
    purpose: '对账与退款',
    required: '支付时必需',
    keep: '长期（当前未启用真实支付）',
  },
  {
    field: '设备标识 / 机型 / 系统版本',
    source: '客户端读取系统属性',
    purpose: '异常登录识别、故障定位',
    required: '登录后必需',
    keep: '每设备保留最近一次',
  },
  {
    field: '网络类型 / 运营商',
    source: '客户端读取，取不到留空',
    purpose: '区分网络故障',
    required: '登录后必需',
    keep: '每设备保留最近一次',
  },
  {
    field: 'IP 地址',
    source: '服务端在请求到达时记录',
    purpose: '安全审计、异常登录识别',
    required: '必需',
    keep: '每设备保留最近一次',
  },
  {
    field: '采集时间',
    source: '服务端写入时间',
    purpose: '判断快照新鲜度',
    required: '必需',
    keep: '随快照覆盖',
  },
  {
    field: '访问时间 / 路径 / 脱敏 IP / 脱敏设备号',
    source: '服务端自动产生',
    purpose: '故障排查与安全审计',
    required: '必需',
    keep: '由部署环境轮转',
  },
];

onLoad((options) => {
  gate.value = options?.mode === 'gate';
});

function agree(): void {
  // 先落盘再跳转：WebView 写入是同步的，原生兜底异步进行，不阻塞离开本页。
  // 仅当 privacy.ts 的 PRIVACY_GATE_MODE 为 'launch' 时才会走到这个启动门禁；
  // 默认 'register' 下同意是在注册页勾选完成并随注册请求上报服务端。
  void recordPrivacyConsent('launch:gate');
  uni.reLaunch({ url: ROUTES.home });
}

function decline(): void {
  uni.showModal({
    title: '尚未同意隐私政策',
    content:
      '不同意将无法使用账号、商城与订单功能；本页文字仍可继续阅读。你可以稍后重新点击「同意并继续」，或退出应用后再决定。',
    cancelText: '继续阅读',
    confirmText: '退出应用',
    success: (res) => {
      if (res.confirm) exitApp();
    },
  });
}

/** 原生壳里通过自定义 scheme 退出；网页端提示关闭标签页即可。 */
function exitApp(): void {
  const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (capacitor && typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform()) {
    window.location.href = 'mixmapp-action://exit';
    return;
  }
  uni.showToast({ title: '可直接关闭当前页面', icon: 'none' });
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $paper;
  padding: 0 $sp-4 calc($sp-6 + var(--mx-safe-bottom));
}

.page--gate {
  padding-bottom: calc(180rpx + var(--mx-safe-bottom));
}

.head {
  padding: $sp-5 0 $sp-3;
}

.title {
  display: block;
  margin-top: 16rpx;
  font-family: $font-display;
  font-size: $fs-h1;
  font-weight: 800;
  letter-spacing: $ls-tight;
  line-height: $lh-tight;
  @include mx-gradient-text;
}

.sub {
  display: block;
  margin: $sp-2 0 $sp-3;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-3;
}

.sec {
  margin-top: $sp-5;
}

/* 变更要点用浅底块，和正文区分开 */
.sec--change {
  margin-top: $sp-4;
  padding: $sp-3;
  border-radius: $r-card;
  background: $paper-2;
}

.sec-name {
  display: block;
  margin-bottom: $sp-2;
  font-family: $font-display;
  font-size: $fs-h3;
  font-weight: 800;
  letter-spacing: $ls-tight;
  color: $ink;
}

.para {
  display: block;
  margin-bottom: $sp-2;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.para--note {
  margin-top: $sp-2;
  font-size: $fs-micro;
  color: $ink-3;
}

/* ---------- 收集清单表格 ---------- */
.tbl {
  margin-top: $sp-2;
  border-top: 1rpx solid $paper-3;
}

.tbl-head,
.tbl-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1rpx solid $paper-3;
}

.tbl-head {
  background: $paper-2;
}

.th {
  padding: 12rpx 6rpx;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  color: $ink-3;
  text-transform: uppercase;
}

.td {
  padding: 14rpx 6rpx;
  font-size: $fs-micro;
  line-height: 1.5;
  color: $ink-2;
  word-break: break-word;
}

.c1 { flex: 0 0 24%; }
.c2 { flex: 0 0 20%; }
.c3 { flex: 0 0 22%; }
.c4 { flex: 0 0 14%; }
.c5 { flex: 1 1 20%; }

/* ---------- 字段块 ---------- */
.prow {
  padding: $sp-2 0;
  border-top: 1rpx solid $paper-3;
}

.prow:last-of-type {
  border-bottom: 1rpx solid $paper-3;
  margin-bottom: $sp-2;
}

.prow-k {
  display: block;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  color: $brand-deep;
}

.prow-v {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

/* ---------- 权限块（沿用旧样式） ---------- */
.perm {
  padding: $sp-2 0;
  border-top: 1rpx solid $paper-3;
}

.perm:last-of-type {
  border-bottom: 1rpx solid $paper-3;
  margin-bottom: $sp-2;
}

.perm-k {
  display: block;
  font-size: $fs-micro;
  letter-spacing: $ls-label;
  text-transform: uppercase;
  color: $brand-deep;
}

.perm-v {
  display: block;
  margin-top: 8rpx;
  font-size: $fs-meta;
  line-height: $lh-body;
  color: $ink-2;
}

.tail {
  display: block;
  margin-top: $sp-5;
  font-size: $fs-micro;
  letter-spacing: 1rpx;
  color: $ink-4;
  text-align: center;
}

/* 定位 / 背景 / 内边距 / 安全区一律由 .mx-sticky-bar 提供，这里只排两个按钮 */
.gate-bar {
  display: flex;
  align-items: center;
  gap: $sp-2;
}

.gate-decline {
  flex: 0 0 auto;
}

.gate-agree {
  flex: 1;
}

@media (min-width: 768px) {
  .gate-bar {
    left: 50%;
    right: auto;
    width: 750px;
    transform: translateX(-50%);
  }
}
</style>
