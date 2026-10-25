// components/face-consent/face-consent.js
// 肖像权与个人信息授权弹窗（AI 人像生成类功能共用）。
//
// 背景：2026-10-25 版本审核驳回要求"增加授权声明弹窗"（深度合成/肖像权合规）。
// 使用：<face-consent show="{{showConsent}}" bind:agree="onAgree" bind:cancel="onCancel"/>
//   agree 事件 detail = { remember: Boolean }（勾选"7 天内不再提示"）。
// 弹窗文案四要素：技术说明 / 授权确认（含公众人物警示）/ 用途限制 / 数据留存说明。
// 数据留存承诺"离开页面后自动删除"由调用页的 cleanup 逻辑兑现（见 aiAvatar）。

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    }
  },

  data: {
    remember: false
  },

  methods: {
    toggleRemember() {
      this.setData({ remember: !this.data.remember });
    },

    onCancel() {
      this.setData({ remember: false });
      this.triggerEvent('cancel');
    },

    onAgree() {
      const remember = this.data.remember;
      this.setData({ remember: false });
      this.triggerEvent('agree', { remember });
    },

    // 阻止蒙层下的滚动穿透（空实现捕获 touchmove）
    noop() {}
  }
});
