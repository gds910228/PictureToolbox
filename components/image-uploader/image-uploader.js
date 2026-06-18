// components/image-uploader/image-uploader.js
const imageProcess = require('../../utils/image-process');

Component({
  properties: {
    // 最大图片数量，默认1（单图模式）
    maxCount: {
      type: Number,
      value: 1
    },
    // 当前已选图片列表（支持外部传入，用于编辑场景回显）
    value: {
      type: Array,
      value: []
    },
    // 上传来源：album | camera | ['album', 'camera']
    sourceType: {
      type: Array,
      value: ['album', 'camera']
    },
    // 图片尺寸类型：original | compressed | ['original', 'compressed']
    sizeType: {
      type: Array,
      value: ['original']
    },
    // 是否禁用
    disabled: {
      type: Boolean,
      value: false
    },
    // 是否显示压缩提示
    showCompressTip: {
      type: Boolean,
      value: true
    },
    // 上传区域提示文字
    tipText: {
      type: String,
      value: '点击选择图片'
    },
    // 上传区域提示副标题
    tipSubtext: {
      type: String,
      value: ''
    },
    // 是否支持拖拽排序（仅 maxCount > 1 时有效）
    draggable: {
      type: Boolean,
      value: true
    },
    // 主题色：cyan（青色/赛博朋克主色）| green（绿色）| purple（紫色）
    theme: {
      type: String,
      value: 'cyan'
    }
  },

  data: {
    // 内部图片列表
    _images: [],
    // 拖拽相关状态
    _dragging: false,
    _dragIndex: -1,
    _dropIndex: -1,
    // 是否显示大图预览
    _previewVisible: false,
    _previewIndex: 0,
    // 预览URL列表
    _previewUrls: [],
    // 压缩提示
    _showTip: false,
    _tipMessage: ''
  },

  lifetimes: {
    attached() {
      this._initFromValue();
    }
  },

  pageLifetimes: {
    show() {
      // 页面显示时同步 value → _images
      this._initFromValue();
    }
  },

  observers: {
    value(newVal) {
      if (Array.isArray(newVal)) {
        this._initFromValue();
      }
    }
  },

  methods: {
    /**
     * 从 value 属性初始化内部列表
     */
    _initFromValue() {
      const val = this.data.value;
      // 防御：确保 _images 始终是数组
      if (!this.data._images || !Array.isArray(this.data._images)) {
        this.setData({ _images: [] });
      }
      if (Array.isArray(val) && val.length > 0) {
        const images = val.map((item, idx) => {
          if (typeof item === 'string') {
            return { id: this._genId(idx), path: item, size: 0 };
          }
          return { id: item.id || this._genId(idx), path: item.path || item, size: item.size || 0 };
        });
        this.setData({ _images: images });
      }
    },

    _genId(idx) {
      return `img_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 6)}`;
    },

    /**
     * 点击上传区域 / 已选图片
     */
    onTapArea(e) {
      if (this.data.disabled) return;
      const { index } = e.currentTarget.dataset;

      if (index !== undefined) {
        // 点击已选图片 → 预览
        this._previewImage(index);
      } else {
        // 点击上传区 → 选择图片
        this._chooseImage();
      }
    },

    /**
     * 选择图片
     */
    async _chooseImage() {
      const maxCount = this.data.maxCount;
      const currentImages = this.data._images || [];
      const currentCount = currentImages.length;
      const remainCount = maxCount - currentCount;

      if (remainCount <= 0) {
        wx.showToast({ title: `最多选择${maxCount}张图片`, icon: 'none' });
        return;
      }

      try {
        const paths = await imageProcess.chooseImage(
          remainCount,
          this.data.sizeType,
          this.data.sourceType
        );

        if (paths && paths.length > 0) {
          const newImages = paths.map((path, i) => ({
            id: this._genId(currentCount + i),
            path: path,
            size: 0
          }));

          const updated = [...currentImages, ...newImages];
          this.setData({ _images: updated });

          // 获取每张图的大小
          this._fetchSizes(updated);

          // 触发 change 事件
          this._emitChange(updated);

          // 压缩提示
          if (this.data.showCompressTip) {
            this._showCompressNotice(paths.length);
          }
        }
      } catch (err) {
        console.error('[image-uploader] 选择图片失败', err);
        this.triggerEvent('error', { err, type: 'choose' });
      }
    },

    /**
     * 获取图片文件大小
     */
    async _fetchSizes(images) {
      try {
        const withSizes = await Promise.all(
          images.map(async (img) => {
            try {
              const size = await imageProcess.getFileSize(img.path);
              return { ...img, size };
            } catch {
              return img;
            }
          })
        );
        this.setData({ _images: withSizes });
      } catch (e) {
        // sizes fetch failed, ignore
      }
    },

    /**
     * 删除图片
     */
    onDeleteImage(e) {
      e.stopPropagation();
      if (this.data.disabled) return;

      const { index } = e.currentTarget.dataset;
      const currentImages = this.data._images || [];
      const images = currentImages.filter((_, i) => i !== index);
      this.setData({ _images: images });
      this._emitChange(images);
    },

    /**
     * 预览图片（点击放大）
     */
    _previewImage(index) {
      const currentImages = this.data._images || [];
      const urls = currentImages.map(img => img.path);
      if (urls.length === 0) return;

      wx.previewImage({
        current: urls[index],
        urls: urls
      });
    },

    /**
     * 长按开始拖拽（仅多图模式）
     */
    onLongPress(e) {
      if (this.data.disabled) return;
      if (this.data.maxCount <= 1) return;
      if (!this.data.draggable) return;

      const index = e.currentTarget.dataset.index;
      this.setData({
        _dragging: true,
        _dragIndex: index,
        _dropIndex: index
      });

      wx.vibrateShort({ type: 'medium' });
    },

    /**
     * 拖拽进入目标区域
     */
    onDragOver(e) {
      if (!this.data._dragging) return;
      const index = e.currentTarget.dataset.index;
      if (index !== this.data._dropIndex) {
        this.setData({ _dropIndex: index });
      }
    },

    /**
     * 拖拽结束，放置图片
     */
    onDragEnd(e) {
      if (!this.data._dragging) return;

      const { _dragIndex, _dropIndex } = this.data;
      if (_dragIndex === -1 || _dropIndex === -1 || _dragIndex === _dropIndex) {
        this._resetDragState();
        return;
      }

      // 交换数组位置
      const currentImages = this.data._images || [];
      const images = [...currentImages];
      const [moved] = images.splice(_dragIndex, 1);
      images.splice(_dropIndex, 0, moved);

      this.setData({ _images: images });
      this._emitChange(images);
      this._resetDragState();
    },

    _resetDragState() {
      this.setData({
        _dragging: false,
        _dragIndex: -1,
        _dropIndex: -1
      });
    },

    /**
     * 阻止触摸冒泡（多图网格内）
     */
    onBubbleBlock() {
      // 空方法，阻止事件冒泡
    },

    /**
     * 触发 change 事件，通知父组件
     */
    _emitChange(images) {
      const list = images || this.data._images || [];
      const paths = list.map(img => img.path);
      this.triggerEvent('change', {
        images: list,
        paths: paths,
        count: list.length
      });
    },

    /**
     * 大图预览提示
     */
    _showCompressNotice(count) {
      const sizeTip = count > 1
        ? `已添加 ${count} 张图片`
        : '已添加图片';

      this.setData({
        _showTip: true,
        _tipMessage: sizeTip
      });

      setTimeout(() => {
        this.setData({ _showTip: false });
      }, 2000);
    },

    /**
     * 格式化文件大小
     */
    _formatSize(bytes) {
      if (!bytes || bytes <= 0) return '';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    },

    /**
     * 清空所有图片
     */
    clear() {
      this.setData({ _images: [] });
      this._emitChange([]);
    },

    /**
     * 获取当前图片列表（供父组件调用）
     */
    getImages() {
      return this.data._images || [];
    }
  }
});
