'use strict';

const fs = require('fs');
const path = require('path');

function readCsvLines(csvPath) {
  if (!fs.existsSync(csvPath)) {
    return [];
  }
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.trim().split('\n').slice(1); // 跳过表头
  return lines.map(line => {
    const [role, condition, lineText] = line.split(',').map(x => x.trim());
    return { role, condition, line: lineText };
  }).filter(item => item.role && item.condition && item.line);
}

class QvbingMode {
  constructor() {
    this.enabled = false;
    this.lines = [];
    this.csvPath = path.join(__dirname, 'qvbing_mode_lines.csv');
    this.loadLines();
  }

  loadLines() {
    this.lines = readCsvLines(this.csvPath);
  }

  enable() {
    this.enabled = true;
    console.log('趣味模式已开启：《潜伏》致敬模式');
    console.log('注意：为了节省token，平时不建议开启此模式');
  }

  disable() {
    this.enabled = false;
    console.log('趣味模式已关闭');
  }

  toggle() {
    this.enabled = !this.enabled;
    console.log(this.enabled ? '趣味模式已开启' : '趣味模式已关闭');
    return this.enabled;
  }

  getLine(role, condition) {
    if (!this.enabled) {
      return null;
    }
    const matchingLines = this.lines.filter(item => 
      item.role === role && item.condition === condition
    );
    if (matchingLines.length === 0) {
      return null;
    }
    // 随机选择一条匹配的台词
    return matchingLines[Math.floor(Math.random() * matchingLines.length)].line;
  }

  // 检查是否应该触发趣味模式台词
  checkAndEmit(role, condition, context = {}) {
    if (!this.enabled) {
      return null;
    }
    const line = this.getLine(role, condition);
    if (line) {
      const message = `[${role}] ${line}`;
      console.log(message);
      // 可以根据需要将消息添加到日志中
      return message;
    }
    return null;
  }
}

// 导出单例实例
const qvbingMode = new QvbingMode();
module.exports = qvbingMode;