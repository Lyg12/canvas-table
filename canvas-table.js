/**
 * Canvas虚拟表格 - 基于父容器滚动
 * 支持10万+数据
 */
class CanvasVirtualTable {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.wrapper 滚动容器（overflow: auto）
   * @param {HTMLElement} options.container canvas容器
   * @param {HTMLCanvasElement} options.canvas canvas元素
   * @param {HTMLElement} options.placeholder 滚动占位元素
   * @param {Array} options.data 数据源
   * @param {Array} options.columns 列配置
   * @param {number} options.rowHeight 行高，默认35
   * @param {number} options.headerHeight 表头高度，默认40
   * @param {number} options.bufferRatio 缓冲区比例，默认0.5
   */
  constructor(options) {
    this.wrapper = options.wrapper; // 滚动容器
    this.container = options.container; // canvas容器
    this.canvas = options.canvas; // canvas元素
    this.placeholder = options.placeholder; // 滚动占位元素
    this.data = options.data || [];
    this.columns = options.columns || [];
    this.rowHeight = options.rowHeight || 35;
    this.headerHeight = options.headerHeight || 40;
    this.bufferRatio = options.bufferRatio || 0.5;
    this.fontSize = options.fontSize || 14;

    // 状态
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.containerWidth = 0;
    this.containerHeight = 0;
    this.totalHeight = 0; // 总内容高度

    // 列缓存
    this.columnCache = new Map();
    this.totalWidth = 0;

    // 可见范围
    this.visibleRange = { start: 0, end: 0 };

    // 性能监控
    this.fps = 60;
    this.frameCount = 0;
    this.lastFPSUpdate = performance.now();

    // 动画帧
    this.rafId = null;
    this.scrollRafId = null;
    this.scrollbarSize = this.getScrollbarSize();
    // 初始化
    this.init();
  }
  /**
   * 获取滚动条高度
   */
  getScrollbarSize() {
    // 创建检测元素
    const div = document.createElement("div");
    div.style.cssText = `
            width: 100px;
            height: 100px;
            overflow: scroll;
            position: absolute;
            top: -9999px;
            visibility: hidden;
        `;

    document.body.appendChild(div);
    const scrollbarWidth = div.offsetWidth - div.clientWidth;
    const scrollbarHeight = div.offsetHeight - div.clientHeight;
    document.body.removeChild(div);

    return { width: scrollbarWidth, height: scrollbarHeight };
  }

  /**
   * 初始化
   */
  init() {
    this.initCanvas();
    this.calculateColumnPositions();
    this.updateTotalHeight();
    this.updatePlaceholderSize();
    this.updateCanvasSize();
    this.initEventListeners();
    this.render();
    this.startFPSMonitor();
  }

  /**
   * 初始化Canvas上下文
   */
  initCanvas() {
    this.ctx = this.canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
  }

  /**
   * 检查是否需要横向滚动条
   */
  hasHorizontalScrollbar() {
    console.log(this.totalWidth, this.containerWidth);
    return this.totalWidth > this.containerWidth;
  }

  /**
   * 获取实际可用的容器高度
   */
  getAvailableHeight() {
    let availableHeight = this.containerHeight;

    // 如果内容宽度大于容器宽度，需要显示横向滚动条
    // if (this.hasHorizontalScrollbar()) {
    //   availableHeight -= this.scrollbarSize.height;
    // }

    return Math.max(0, availableHeight);
  }

  /**
   * 更新Canvas尺寸
   */
  updateCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    this.containerWidth = this.wrapper.clientWidth;
    this.containerHeight = this.wrapper.clientHeight;

    // 获取实际可用高度
    const availableHeight = this.getAvailableHeight();
    this.canvas.width = this.containerWidth * dpr;
    this.canvas.height = availableHeight * dpr;
    this.ctx.scale(dpr, dpr);
  }

  /**
   * 计算总内容高度（用于滚动）
   */
  updateTotalHeight() {
    this.totalHeight = this.data.length * this.rowHeight + this.headerHeight;
  }

  /**
   * 更新滚动占位元素尺寸
   */
  updatePlaceholderSize() {
    // 设置占位元素的大小，撑开滚动区域
    this.placeholder.style.width = this.totalWidth + "px";
    this.placeholder.style.height = this.totalHeight + "px";
  }

  /**
   * 计算列位置
   */
  calculateColumnPositions() {
    let left = 0;
    this.totalWidth = 0;

    this.columns.forEach((col) => {
      const width = col.width || this.estimateColumnWidth(col);
      this.columnCache.set(col.key, {
        width: width,
        left: left,
      });
      left += width;
    });

    this.totalWidth = left;
  }

  /**
   * 估算列宽
   */
  estimateColumnWidth(column) {
    const minWidth = 80;
    const maxWidth = 300;
    const padding = 16;

    const sampleSize = Math.min(100, this.data.length);

    // 测量表头
    this.ctx.font = `bold ${this.fontSize}px Arial`;
    let maxWidth_px = this.ctx.measureText(column.title).width + padding;

    // 采样数据
    this.ctx.font = `${this.fontSize}px Arial`;
    for (let i = 0; i < sampleSize; i++) {
      const row = this.data[i];
      if (!row) continue;

      const value = row[column.key];
      let text = column.render
        ? column.render(value, row)
        : String(value || "");

      const textWidth = this.ctx.measureText(text).width + padding;
      if (textWidth > maxWidth_px) {
        maxWidth_px = Math.min(textWidth, maxWidth);
      }
    }

    return Math.max(minWidth, Math.ceil(maxWidth_px));
  }

  /**
   * 计算可见行范围
   */
  calculateVisibleRange() {
    const availableHeight = this.getAvailableHeight();

    // 减去表头高度
    const contentScrollTop = Math.max(0, this.scrollTop - this.headerHeight);

    const bufferSize = Math.ceil(
      (availableHeight / this.rowHeight) * this.bufferRatio,
    );

    // 计算可见行范围，确保包含部分可见的行
    let startRow = Math.max(
      0,
      Math.floor(contentScrollTop / this.rowHeight) - bufferSize,
    );
    let endRow = Math.min(
      this.data.length - 1,
      Math.ceil((contentScrollTop + availableHeight) / this.rowHeight) +
        bufferSize,
    );

    // 当滚动到顶部时，确保包含第0行
    if (this.scrollTop < this.headerHeight) {
      startRow = 0;
    }

    this.visibleRange = { start: startRow, end: endRow };

    // 更新UI显示
    const visibleRowsEl = document.getElementById("visibleRows");
    if (visibleRowsEl) {
      visibleRowsEl.textContent = `${startRow}-${endRow}`;
    }
  }

  /**
   * 获取可见列
   */
  getVisibleColumns() {
    const visible = [];

    this.columnCache.forEach((info, key) => {
      const right = info.left + info.width;
      if (
        right >= this.scrollLeft &&
        info.left <= this.scrollLeft + this.containerWidth
      ) {
        visible.push({
          key: key,
          width: info.width,
          left: info.left,
        });
      }
    });

    return visible;
  }

  /**
   * 渲染表格
   */
  render = () => {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }

    this.rafId = requestAnimationFrame(() => {
      this.calculateVisibleRange();
      this.draw();
      this.rafId = null;
    });
  };

  /**
   * 绘制表格
   */
  draw() {
    const availableHeight = this.getAvailableHeight();
    // 清空画布
    this.ctx.clearRect(0, 0, this.containerWidth, availableHeight);

    // 背景
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.containerWidth, availableHeight);

    const visibleColumns = this.getVisibleColumns();
    const { start, end } = this.visibleRange;

    // 1. 先绘制网格线（最底层）
    this.drawGridLines(visibleColumns, start, end, availableHeight);

    // 2. 再绘制数据行（中间层）
    for (let i = start; i <= end; i++) {
      this.drawRow(i, visibleColumns, availableHeight);
    }

    // 3. 最后绘制表头（最上层，覆盖数据行）
    this.drawHeader(visibleColumns);

    // 空状态
    if (this.data.length === 0) {
      this.drawEmptyState();
    }
  }

  /**
   * 绘制表头
   */
  drawHeader(visibleColumns) {
    // 表头背景 - 使用纯色确保覆盖下方内容
    this.ctx.fillStyle = "#f0f0f0";
    this.ctx.fillRect(0, 0, this.containerWidth, this.headerHeight);

    // 添加表头底部阴影或边框，增强层次感
    this.ctx.shadowColor = "rgba(0, 0, 0, 0.1)";
    this.ctx.shadowBlur = 3;
    this.ctx.shadowOffsetY = 2;

    // 表头文字
    this.ctx.fillStyle = "#333333";
    this.ctx.font = `bold ${this.fontSize}px Arial`;
    this.ctx.textBaseline = "middle";
    this.ctx.textAlign = "left";

    // 关闭阴影避免影响文字
    this.ctx.shadowColor = "transparent";

    visibleColumns.forEach((col) => {
      const x = col.left - this.scrollLeft;
      const column = this.columns.find((c) => c.key === col.key);
      if (!column) return;

      let title = column.title;
      const maxWidth = col.width - 16;

      if (this.ctx.measureText(title).width > maxWidth) {
        title = this.truncateText(title, maxWidth);
      }

      this.ctx.fillText(title, x + 8, this.headerHeight / 2);
    });

    // 绘制表头底部边框
    this.ctx.strokeStyle = "#cccccc";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, this.headerHeight);
    this.ctx.lineTo(this.containerWidth, this.headerHeight);
    this.ctx.stroke();
  }

  /**
   * 绘制行
   */
  drawRow(rowIndex, visibleColumns, availableHeight) {
    // 计算Y坐标：行索引 * 行高 - (滚动位置 - 表头高度)
    const y = rowIndex * this.rowHeight - (this.scrollTop - this.headerHeight);

    // 计算行的实际显示区域
    const rowTop = y; // 行顶部位置
    const rowBottom = y + this.rowHeight; // 行底部位置

    // 计算可见区域的顶部和底部
    const visibleTop = Math.max(rowTop, this.headerHeight);
    const visibleBottom = Math.min(rowBottom, availableHeight);

    // 如果行完全不可见，跳过
    if (
      visibleTop >= visibleBottom ||
      visibleBottom <= this.headerHeight ||
      visibleTop >= availableHeight
    ) {
      return;
    }

    // 可见高度
    const visibleHeight = visibleBottom - visibleTop;

    const row = this.data[rowIndex];
    if (!row) return;

    // 斑马纹 - 只绘制可见部分
    if (rowIndex % 2 === 0) {
      this.ctx.fillStyle = "#f9f9f9";
      this.ctx.fillRect(0, visibleTop, this.containerWidth, visibleHeight);
    }

    // 绘制单元格
    this.ctx.fillStyle = "#333333";
    this.ctx.font = `${this.fontSize}px Arial`;

    visibleColumns.forEach((col) => {
      const x = col.left - this.scrollLeft;
      const column = this.columns.find((c) => c.key === col.key);
      if (!column) return;

      const value = row[column.key];
      let text = column.render
        ? column.render(value, row)
        : String(value || "");

      const maxWidth = col.width - this.fontSize;
      if (this.ctx.measureText(text).width > maxWidth) {
        text = this.truncateText(text, maxWidth);
      }

      // 判断行是否被表头遮挡
      if (rowTop < this.headerHeight) {
        // 行被表头遮挡：文字从可见区域顶部开始
        this.ctx.textBaseline = "bottom";
        const textY = rowTop + this.rowHeight / 2 + this.fontSize / 2;
        this.ctx.fillText(text, x + 8, textY);
      } else {
        // 行完整可见：文字垂直居中
        this.ctx.textBaseline = "middle";
        const textY = rowTop + this.rowHeight / 2;
        this.ctx.fillText(text, x + 8, textY);
      }
    });
  }

  /**
   * 绘制网格线
   */
  drawGridLines(visibleColumns, startRow, endRow, availableHeight) {
    this.ctx.strokeStyle = "#e0e0e0";
    this.ctx.lineWidth = 1;

    // 绘制列线（贯穿整个高度）
    visibleColumns.forEach((col) => {
      const x = col.left - this.scrollLeft;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, availableHeight);
      this.ctx.stroke();
    });

    // 绘制行线 - 处理部分可见的行
    for (let i = startRow; i <= endRow + 1; i++) {
      const y = i * this.rowHeight - (this.scrollTop - this.headerHeight);

      // 行线的Y坐标
      const lineY = Math.max(y, this.headerHeight);

      // 如果行线在可视区域内
      if (lineY >= this.headerHeight && lineY <= availableHeight) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, lineY);
        this.ctx.lineTo(this.containerWidth, lineY);
        this.ctx.stroke();
      }
    }
  }

  /**
   * 绘制空状态
   */
  drawEmptyState() {
    this.ctx.fillStyle = "#999999";
    this.ctx.font = "14px Arial";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(
      "暂无数据",
      this.containerWidth / 2,
      this.containerHeight / 2,
    );
  }

  /**
   * 截断文本
   */
  truncateText(text, maxWidth) {
    if (this.ctx.measureText(text).width <= maxWidth) {
      return text;
    }

    let truncated = text;
    while (
      this.ctx.measureText(truncated + "...").width > maxWidth &&
      truncated.length > 0
    ) {
      truncated = truncated.slice(0, -1);
    }

    return truncated + "...";
  }

  /**
   * 初始化事件监听
   */
  initEventListeners() {
    // 滚动事件监听在wrapper上
    this.wrapper.addEventListener("scroll", () => {
      if (this.scrollRafId) {
        cancelAnimationFrame(this.scrollRafId);
      }

      this.scrollRafId = requestAnimationFrame(() => {
        // 只记录滚动位置，canvas不动
        this.scrollTop = this.wrapper.scrollTop;
        this.scrollLeft = this.wrapper.scrollLeft;

        this.canvas.style.transform = `translate(${this.scrollLeft}px, ${this.scrollTop}px)`;

        // 更新显示
        const scrollPosEl = document.getElementById("scrollPos");
        if (scrollPosEl) {
          scrollPosEl.textContent = this.scrollTop;
        }

        // 重新绘制内容（canvas本身不动）
        this.render();
        this.scrollRafId = null;
      });
    });

    window.addEventListener("resize", () => {
      this.handleResize();
    });
  }

  /**
   * 处理窗口大小变化
   */
  handleResize() {
    this.updateCanvasSize();
    this.render();
  }

  /**
   * 启动FPS监控
   */
  startFPSMonitor() {
    const updateFPS = () => {
      this.frameCount++;
      const now = performance.now();
      const delta = now - this.lastFPSUpdate;

      if (delta >= 1000) {
        this.fps = Math.round((this.frameCount * 1000) / delta);
        this.frameCount = 0;
        this.lastFPSUpdate = now;

        const fpsEl = document.getElementById("fps");
        if (fpsEl) {
          fpsEl.textContent = this.fps;
        }
      }

      requestAnimationFrame(updateFPS);
    };

    requestAnimationFrame(updateFPS);
  }

  /**
   * 更新数据
   */
  setData(newData) {
    this.data = newData || [];
    this.updateTotalHeight();
    this.updatePlaceholderSize();
    this.calculateColumnPositions(); // 重新估算列宽
    this.render();
  }

  /**
   * 滚动到指定行
   */
  scrollToRow(rowNumber) {
    const targetScroll = (rowNumber - 1) * this.rowHeight;
    this.wrapper.scrollTop = targetScroll;
  }

  /**
   * 销毁
   */
  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    if (this.scrollRafId) {
      cancelAnimationFrame(this.scrollRafId);
    }
    window.removeEventListener("resize", this.handleResize);
  }
}

// ==================== 使用示例 ====================

// 生成测试数据
function generateLargeData(count) {
  const data = [];
  const departments = [
    "技术部",
    "市场部",
    "运营部",
    "人事部",
    "财务部",
    "产品部",
  ];
  const cities = [
    "北京",
    "上海",
    "广州",
    "深圳",
    "杭州",
    "成都",
    "武汉",
    "西安",
  ];

  for (let i = 0; i < count; i++) {
    data.push({
      id: i + 1,
      name: `用户${i + 1}`,
      age: Math.floor(Math.random() * 40) + 20,
      gender: i % 2 === 0 ? "男" : "女",
      department: departments[Math.floor(Math.random() * departments.length)],
      city: cities[Math.floor(Math.random() * cities.length)],
      salary: Math.floor(Math.random() * 50000) + 5000,
      email: `user${i + 1}@example.com`,
      phone: `138${String(i).padStart(8, "0")}`,
      joinDate: `202${Math.floor(Math.random() * 4)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, "0")}-01`,
      status: Math.random() > 0.2 ? "在职" : "离职",
      score: Math.floor(Math.random() * 100),
    });
  }

  return data;
}

// 初始化
document.addEventListener("DOMContentLoaded", () => {
  const wrapper = document.getElementById("tableWrapper");
  const container = document.getElementById("canvasContainer");
  const canvas = document.getElementById("tableCanvas");
  const placeholder = document.getElementById("scrollPlaceholder");
  const dataCountEl = document.getElementById("dataCount");

  // 生成10万条数据
  const data = generateLargeData(100000);
  dataCountEl.textContent = data.length;

  // 列配置
  const columns = [
    { key: "id", title: "ID", width: 80 },
    { key: "name", title: "姓名", width: 100 },
    { key: "age", title: "年龄", width: 80 },
    { key: "gender", title: "性别", width: 80 },
    { key: "department", title: "部门", width: 100 },
    { key: "city", title: "城市", width: 100 },
    {
      key: "salary",
      title: "薪资",
      width: 120,
      render: (value) => `¥${value.toLocaleString()}`,
    },
    { key: "email", title: "邮箱", width: 200 },
    { key: "phone", title: "电话", width: 150 },
    { key: "joinDate", title: "入职日期", width: 120 },
    {
      key: "status",
      title: "状态",
      width: 80,
      render: (value) => (value === "在职" ? "✓ 在职" : "✗ 离职"),
    },
    { key: "score", title: "绩效分", width: 100 },
  ];

  // 创建表格实例
  const table = new CanvasVirtualTable({
    wrapper: wrapper,
    container: container,
    canvas: canvas,
    placeholder: placeholder,
    data: data,
    columns: columns,
    rowHeight: 35,
    headerHeight: 40,
    bufferRatio: 0.5,
  });

  // 添加控制按钮
  const infoBar = document.getElementById("infoBar");
  const btnGroup = document.createElement("div");
  btnGroup.style.marginTop = "10px";
  btnGroup.innerHTML = `
        <button id="btnScrollTo5000">滚动到第5000行</button>
        <button id="btnScrollTo10000">滚动到第10000行</button>
        <button id="btnUpdateData">更新数据</button>
        <button id="btnShowScrollInfo">显示滚动信息</button>
    `;
  infoBar.appendChild(btnGroup);

  document.getElementById("btnScrollTo5000").addEventListener("click", () => {
    table.scrollToRow(5000);
  });

  document.getElementById("btnScrollTo10000").addEventListener("click", () => {
    table.scrollToRow(10000);
  });

  document.getElementById("btnUpdateData").addEventListener("click", () => {
    const newData = generateLargeData(100000);
    table.setData(newData);
    dataCountEl.textContent = newData.length;
  });

  document.getElementById("btnShowScrollInfo").addEventListener("click", () => {
    alert(`总高度: ${table.totalHeight}px\n行数: ${data.length}\n行高: 35px`);
  });
});
