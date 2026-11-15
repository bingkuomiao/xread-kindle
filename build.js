const fs = require('fs');
const { minify } = require('terser');
const htmlMinifier = require('html-minifier-terser');

// 正确引入 cssnano 和 postcss
const postcss = require('postcss');
const cssnano = require('cssnano');

async function compressProject() {
  try {
    console.log('🚀 开始最大程度压缩...');
    
    // 读取原始文件
    const htmlContent = fs.readFileSync('index.html', 'utf8');
    let cssContent = '';
    
    // 读取外部 CSS 文件（如果存在）
    if (fs.existsSync('css/kindle.css')) {
      cssContent = fs.readFileSync('css/kindle.css', 'utf8');
      console.log('📖 找到外部CSS文件');
    }
    
    // 提取内联 CSS 和 JS
    const cssRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    const jsRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    
    let processedHTML = htmlContent;
    
    // 压缩内联 CSS
    processedHTML = await replaceAsync(processedHTML, cssRegex, async (match, css) => {
      try {
        console.log('🔄 压缩内联CSS...');
        // 使用正确的 cssnano API
        const result = await postcss([cssnano()]).process(css, { from: undefined });
        return `<style>${result.css}</style>`;
      } catch (error) {
        console.warn('❌ 内联 CSS 压缩失败:', error.message);
        // 简单压缩作为备用
        const simpleCompressed = css
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s+/g, ' ')
          .replace(/\s*([{}:;,])\s*/g, '$1')
          .replace(/;}/g, '}')
          .trim();
        return `<style>${simpleCompressed}</style>`;
      }
    });
    
    // 压缩内联 JavaScript
    processedHTML = await replaceAsync(processedHTML, jsRegex, async (match, js) => {
      if (js.trim()) {
        try {
          console.log('🔄 压缩内联JS...');
          const result = await minify(js, {
            compress: {
              drop_console: true,
              drop_debugger: true,
            },
            mangle: {
              toplevel: true,
            },
            format: {
              comments: false,
            }
          });
          return `<script>${result.code}</script>`;
        } catch (error) {
          console.warn('❌ JavaScript 压缩失败，使用原代码');
          return match;
        }
      }
      return match;
    });
    
    // 压缩外部 CSS（如果存在）
    let compressedCSS = cssContent;
    if (cssContent) {
      try {
        console.log('🔄 压缩外部CSS...');
        // 使用正确的 cssnano API
        const result = await postcss([cssnano()]).process(cssContent, { from: undefined });
        compressedCSS = result.css;
        console.log('✅ 外部CSS压缩成功');
      } catch (error) {
        console.warn('❌ 外部 CSS 压缩失败:', error.message);
        // 简单压缩作为备用
        compressedCSS = cssContent
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s+/g, ' ')
          .replace(/\s*([{}:;,])\s*/g, '$1')
          .replace(/;}/g, '}')
          .trim();
        console.log('ℹ️ 使用简单CSS压缩');
      }
    }
    
    // 处理 JS 文件
    console.log('🔄 处理JS文件...');
    if (fs.existsSync('js')) {
      if (!fs.existsSync('out/js')) {
        fs.mkdirSync('out/js', { recursive: true });
      }
      
      // 读取 js 目录下的所有文件
      const jsFiles = fs.readdirSync('js');
      
      for (const file of jsFiles) {
        if (file.endsWith('.js')) {
          const filePath = `js/${file}`;
          const jsContent = fs.readFileSync(filePath, 'utf8');
          
          // config.js 不进行压缩，直接复制
          if (file === 'config.js') {
            console.log(`📋 复制 ${file} (跳过压缩)`);
            fs.writeFileSync(`out/js/${file}`, jsContent);
            continue;
          }
          
          try {
            console.log(`🔄 压缩 ${file}...`);
            const result = await minify(jsContent, {
              compress: {
                drop_console: true,
                drop_debugger: true,
              },
              mangle: {
                toplevel: true,
              },
              format: {
                comments: false,
              }
            });
            
            fs.writeFileSync(`out/js/${file}`, result.code);
            console.log(`✅ ${file} 压缩成功`);
          } catch (error) {
            console.warn(`❌ ${file} 压缩失败，使用原代码:`, error.message);
            fs.writeFileSync(`out/js/${file}`, jsContent);
          }
        }
      }
    }
    
    // 最终 HTML 压缩
    console.log('🔄 压缩HTML结构...');
    const finalHTML = await htmlMinifier.minify(processedHTML, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: false, // 已经手动压缩过
      removeAttributeQuotes: false,
      removeEmptyAttributes: false,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true
    });
    
    // 创建输出目录
    if (!fs.existsSync('out')) {
      fs.mkdirSync('out', { recursive: true });
    }
    
    // 写入压缩后的 HTML
    fs.writeFileSync('out/index.html', finalHTML);
    
    // 写入压缩后的 CSS（如果存在外部 CSS）
    if (cssContent && fs.existsSync('css')) {
      if (!fs.existsSync('out/css')) {
        fs.mkdirSync('out/css', { recursive: true });
      }
      fs.writeFileSync('out/css/kindle.css', compressedCSS);
    }
    
    // 复制图片文件夹
    if (fs.existsSync('img')) {
      fs.cpSync('img', 'out/img', { recursive: true });
    }

    // 复制字体文件夹
    if (fs.existsSync('fonts')) {
      fs.cpSync('fonts', 'out/fonts', { recursive: true });
    }
    
    // 统计信息
    const originalSize = Buffer.byteLength(htmlContent + cssContent, 'utf8');
    const compressedSize = Buffer.byteLength(finalHTML + compressedCSS, 'utf8');
    const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);
    
    console.log('✅ 最大压缩完成！');
    console.log(`📊 原始大小: ${(originalSize / 1024).toFixed(2)} KB`);
    console.log(`📊 压缩后: ${(compressedSize / 1024).toFixed(2)} KB`);
    console.log(`📈 压缩率: ${compressionRatio}%`);
    
  } catch (error) {
    console.error('❌ 压缩失败:', error);
    process.exit(1);
  }
}

// 辅助函数：异步替换
async function replaceAsync(str, regex, asyncFn) {
  const promises = [];
  str.replace(regex, (match, ...args) => {
    const promise = asyncFn(match, ...args);
    promises.push(promise);
  });
  const data = await Promise.all(promises);
  return str.replace(regex, () => data.shift());
}

compressProject();
