/**
 * 阅读器配置文件
 * 修改此文件中的配置项来调整阅读器设置
 * 修改后需要刷新页面生效
 */

// 阅读器全局配置
window.READER_CONFIG = {
    // 服务器类型：app | multi | single (app 表示手机应用模式,single|multi 表示服务器的单用户/多用户模式)
    type: "multi",
    
    // 服务器地址：留空 = 自动使用「加载本页面的源」(http://host:port)。
    // 这样把 XRead-kindle 挂到后端的 /xread 子路径后，API 会自动指向同源的 /reader3/...，
    // 在 7777 / 7778 等不同端口部署都能免 CORS 复用同一后端，无需修改此处。
    // 如需指向独立后端，可填完整地址，例如 "http://192.168.31.51:7777"。
    address: "",
    
    // 登录用户名（仅server类型需要）
    username: "",
    
    // 登录密码（仅server类型需要）
    password: "",
    
    // 加密盐值（预留功能）
    salt: "",
    
    // 阅读界面字体大小（像素）
    contentFontSize: 47,
    
    // 行间距（倍数）
    lineHeight: 1.3,
    
    // 字体家族
    // 可选值： 系统默认, 世间美好, 云朵字体, 糯米圆体, 御风楷体, 方正品尚
    fontFamily: "系统默认",
   
    // 字体加粗 可选值： normal, bold
    fontWeight: "normal",

    // 字间距（像素）
    letterSpacing: 7,
    
    // 底部信息区字体大小比例（相对于阅读区）
    menuFontSizeRatio: 0.6,
    
    // 默认翻页方式：1-4
    // 1: 左右分区域翻页
    // 2: 上下分区域翻页  
    // 3: 左上角上一页，其余下一页
    // 4: 右上角上一页，其余下一页
    currentClickFunNum: 4,

    // 调试模式开关
    debugMode: false, 
    // 调试级别 0-3, 0禁用，1备用, 2开发， 3缓存
    debugLevel: 0
};
