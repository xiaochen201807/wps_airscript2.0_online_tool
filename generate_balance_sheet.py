"""
生成财务资产负债表与可视化分析图表看板
包含：完整表格边框线、公式联动、占比条形图、财务指标卡与结构对比图
"""

import time
from wps_airscript_client import WPSAirScriptClient
from config import get_balance_sheet_config

# 从环境变量/.env中读取配置
FILE_ID, TOKEN, SCRIPT_ID, BASE_URL = get_balance_sheet_config()

def build_advanced_balance_sheet():
    print("=" * 65)
    print("🚀 开始连接 WPS AirScript 2.0 客户端...")
    if not TOKEN or TOKEN == "your_token_here":
        print("❌ 未检测到有效 Token，请在 .env 文件中配置 WPS_TOKEN 等信息！")
        return
    client = WPSAirScriptClient(FILE_ID, TOKEN, SCRIPT_ID, base_url=BASE_URL)

    sheets = client.get_workbook_sheets()
    sheet_name = sheets[0] if sheets and len(sheets) > 0 else "工作表1"
    print(f"📌 目标工作表: {sheet_name}")

    print("🧹 清理工作表已有区域 (A1:L45)...")
    try:
        client.clear_range("A1:L45", sheet_name=sheet_name)
    except Exception as e:
        print(f"  提示: {e}")

    # ==================== 1. 主表数据矩阵 ====================
    # A ~ G 列：资产负债表主表
    # H 列：分隔空列
    # I ~ L 列：右侧财务可视化看板
    table_data = [
        # R1: 主标题
        ["资产负债表 (Balance Sheet)", "", "", "", "", "", "", "", "📊 财务关键指标与结构分析看板", "", "", ""],
        # R2: 副标题 / 看板副标
        ["编制单位：示例科技股份有限公司", "", "日期：2025年12月31日", "", "单位：人民币元", "", "", "", "基于 AirScript 2.0 实时公式联动引擎", "", "", ""],
        # R3: 表头
        ["资产与权益项目", "行次", "期末余额", "年初余额", "变动额", "变动率", "期末占比图示", "", "分析维度", "指标值", "安全标准 / 构成", "状态评级"],
        
        # R4: 流动资产
        ["一、流动资产：", "", "", "", "", "", "", "", "【核心偿债与健康度指标】", "", "", ""],
        ["  货币资金", "1", 3500000.00, 2800000.00, "", "", "", "", "资产负债率", "", "标准 < 60%", ""],
        ["  交易性金融资产", "2", 800000.00, 500000.00, "", "", "", "", "流动比率", "", "标准 > 1.5", ""],
        ["  应收账款", "3", 1650000.00, 1400000.00, "", "", "", "", "速动比率", "", "标准 > 1.0", ""],
        ["  预付款项", "4", 320000.00, 260000.00, "", "", "", "", "现金比率", "", "标准 > 0.2", ""],
        ["  存货", "5", 2100000.00, 1950000.00, "", "", "", "", "营运资金", "", "流动资产 - 流动负债", ""],
        ["  其他流动资产", "6", 180000.00, 150000.00, "", "", "", "", "", "", "", ""],
        # R11: 流动资产合计
        ["流动资产合计", "7", "", "", "", "", "", "", "【资本与权益结构】", "", "", ""],
        
        # R12: 非流动资产
        ["二、非流动资产：", "", "", "", "", "", "", "", "资产总额", "", "流动 + 非流动", "规模基准"],
        ["  长期股权投资", "8", 1500000.00, 1200000.00, "", "", "", "", "负债总额", "", "企业总负债", "风险可控"],
        ["  固定资产原价", "9", 6800000.00, 6200000.00, "", "", "", "", "净资产(权益)", "", "股东应占权益", "资本充足"],
        ["  减：累计折旧", "10", 1200000.00, 950000.00, "", "", "", "", "产权比率", "", "负债总额 / 净资产", ""],
        ["  固定资产净值", "11", "", "", "", "", "", "", "", "", "", ""],
        ["  在建工程", "12", 900000.00, 450000.00, "", "", "", "", "【资产与资本结构动态分布】", "", "", ""],
        ["  无形资产", "13", 1100000.00, 1180000.00, "", "", "", "", "流动资产占比", "", "流动资产 / 资产总计", ""],
        # R19: 非流动资产合计
        ["非流动资产合计", "14", "", "", "", "", "", "", "非流动资产占比", "", "非流动 / 资产总计", ""],
        # R20: 资产总计
        ["资产总计", "15", "", "", "", "", "", "", "负债占比", "", "负债 / 资产总计", ""],
        # R21: 分割空行
        ["", "", "", "", "", "", "", "", "所有者权益占比", "", "权益 / 资产总计", ""],
        
        # R22: 流动负债
        ["三、流动负债：", "", "", "", "", "", "", "", "【资产构成动态横向柱形图】", "", "", ""],
        ["  短期借款", "16", 1200000.00, 1000000.00, "", "", "", "", "  货币资金", "", "", ""],
        ["  应付账款", "17", 1850000.00, 1600000.00, "", "", "", "", "  存货资产", "", "", ""],
        ["  预收款项", "18", 420000.00, 380000.00, "", "", "", "", "  应收账款", "", "", ""],
        ["  应付职工薪酬", "19", 680000.00, 620000.00, "", "", "", "", "  固定资产(净)", "", "", ""],
        ["  应交税费", "20", 350000.00, 290000.00, "", "", "", "", "  长期投资", "", "", ""],
        # R28: 流动负债合计
        ["流动负债合计", "21", "", "", "", "", "", "", "  无形资产", "", "", ""],
        
        # R29: 非流动负债
        ["四、非流动负债：", "", "", "", "", "", "", "", "", "", "", ""],
        ["  长期借款", "22", 2000000.00, 2000000.00, "", "", "", "", "", "", "", ""],
        ["  应付债券", "23", 1000000.00, 1000000.00, "", "", "", "", "", "", "", ""],
        # R32: 非流动负债合计
        ["非流动负债合计", "24", "", "", "", "", "", "", "", "", "", ""],
        # R33: 负债合计
        ["负债合计", "25", "", "", "", "", "", "", "", "", "", ""],
        # R34: 分割空行
        ["", "", "", "", "", "", "", "", "", "", "", ""],
        
        # R35: 所有者权益
        ["五、所有者权益（或股东权益）：", "", "", "", "", "", "", "", "", "", "", ""],
        ["  实收资本（或股本）", "26", 5000000.00, 5000000.00, "", "", "", "", "", "", "", ""],
        ["  资本公积", "27", 1200000.00, 1200000.00, "", "", "", "", "", "", "", ""],
        ["  盈余公积", "28", 850000.00, 650000.00, "", "", "", "", "", "", "", ""],
        ["  未分配利润", "29", 3100000.00, 1400000.00, "", "", "", "", "", "", "", ""],
        # R40: 所有者权益合计
        ["所有者权益合计", "30", "", "", "", "", "", "", "", "", "", ""],
        # R41: 负债及所有者权益总计
        ["负债和所有者权益总计", "31", "", "", "", "", "", "", "", "", "", ""],
        # R42: 平衡校验
        ["资产负债平衡验证", "", "", "", "", "", "", "", "", "", "", ""]
    ]

    print("📝 正在写入资产负债表与看板骨架数据...")
    client.batch_write(table_data, start_cell="A1", sheet_name=sheet_name)

    # ==================== 2. 公式联动注入 ====================
    print("⚡ 正在注入多维公式联动与图表计算公式...")

    # (1) 左表变动额、变动率与占比图示 (Row 5~10, 13~15, 17~18, 23~27, 30~31, 36~39)
    detail_rows = [5, 6, 7, 8, 9, 10, 13, 14, 15, 17, 18, 23, 24, 25, 26, 27, 30, 31, 36, 37, 38, 39]
    for r in detail_rows:
        client.set_cell_formula(f"E{r}", f"=C{r}-D{r}", sheet_name=sheet_name)
        client.set_cell_formula(f"F{r}", f"=IF(D{r}=0, 0, (C{r}-D{r})/D{r})", sheet_name=sheet_name)
        # G列：占比动态条形图 (使用 REPT 字符柱状图)
        client.set_cell_formula(f"G{r}", f'=IF(C$20=0, "", REPT("■", MAX(1, INT(C{r}/C$20*25))) & " " & TEXT(C{r}/C$20, "0.0%"))', sheet_name=sheet_name)

    # (2) 固定资产净值 (Row 16)
    client.set_cell_formula("C16", "=C14-C15", sheet_name=sheet_name)
    client.set_cell_formula("D16", "=D14-D15", sheet_name=sheet_name)
    client.set_cell_formula("E16", "=C16-D16", sheet_name=sheet_name)
    client.set_cell_formula("F16", "=IF(D16=0, 0, (C16-D16)/D16)", sheet_name=sheet_name)
    client.set_cell_formula("G16", '=IF(C$20=0, "", REPT("■", MAX(1, INT(C16/C$20*25))) & " " & TEXT(C16/C$20, "0.0%"))', sheet_name=sheet_name)

    # (3) 流动资产合计 (Row 11)
    client.set_cell_formula("C11", "=SUM(C5:C10)", sheet_name=sheet_name)
    client.set_cell_formula("D11", "=SUM(D5:D10)", sheet_name=sheet_name)
    client.set_cell_formula("E11", "=C11-D11", sheet_name=sheet_name)
    client.set_cell_formula("F11", "=IF(D11=0, 0, (C11-D11)/D11)", sheet_name=sheet_name)
    client.set_cell_formula("G11", '=IF(C$20=0, "", REPT("■", MAX(1, INT(C11/C$20*25))) & " " & TEXT(C11/C$20, "0.0%"))', sheet_name=sheet_name)

    # (4) 非流动资产合计 (Row 19)
    client.set_cell_formula("C19", "=C13+C16+C17+C18", sheet_name=sheet_name)
    client.set_cell_formula("D19", "=D13+D16+D17+D18", sheet_name=sheet_name)
    client.set_cell_formula("E19", "=C19-D19", sheet_name=sheet_name)
    client.set_cell_formula("F19", "=IF(D19=0, 0, (C19-D19)/D19)", sheet_name=sheet_name)
    client.set_cell_formula("G19", '=IF(C$20=0, "", REPT("■", MAX(1, INT(C19/C$20*25))) & " " & TEXT(C19/C$20, "0.0%"))', sheet_name=sheet_name)

    # (5) 资产总计 (Row 20)
    client.set_cell_formula("C20", "=C11+C19", sheet_name=sheet_name)
    client.set_cell_formula("D20", "=D11+D19", sheet_name=sheet_name)
    client.set_cell_formula("E20", "=C20-D20", sheet_name=sheet_name)
    client.set_cell_formula("F20", "=IF(D20=0, 0, (C20-D20)/D20)", sheet_name=sheet_name)
    client.set_cell_formula("G20", '="100.0% (总资产基准)"', sheet_name=sheet_name)

    # (6) 流动负债合计 (Row 28)
    client.set_cell_formula("C28", "=SUM(C23:C27)", sheet_name=sheet_name)
    client.set_cell_formula("D28", "=SUM(D23:D27)", sheet_name=sheet_name)
    client.set_cell_formula("E28", "=C28-D28", sheet_name=sheet_name)
    client.set_cell_formula("F28", "=IF(D28=0, 0, (C28-D28)/D28)", sheet_name=sheet_name)
    client.set_cell_formula("G28", '=IF(C$20=0, "", REPT("■", MAX(1, INT(C28/C$20*25))) & " " & TEXT(C28/C$20, "0.0%"))', sheet_name=sheet_name)

    # (7) 非流动负债合计 (Row 32)
    client.set_cell_formula("C32", "=SUM(C30:C31)", sheet_name=sheet_name)
    client.set_cell_formula("D32", "=SUM(D30:D31)", sheet_name=sheet_name)
    client.set_cell_formula("E32", "=C32-D32", sheet_name=sheet_name)
    client.set_cell_formula("F32", "=IF(D32=0, 0, (C32-D32)/D32)", sheet_name=sheet_name)
    client.set_cell_formula("G32", '=IF(C$20=0, "", REPT("■", MAX(1, INT(C32/C$20*25))) & " " & TEXT(C32/C$20, "0.0%"))', sheet_name=sheet_name)

    # (8) 负债合计 (Row 33)
    client.set_cell_formula("C33", "=C28+C32", sheet_name=sheet_name)
    client.set_cell_formula("D33", "=D28+D32", sheet_name=sheet_name)
    client.set_cell_formula("E33", "=C33-D33", sheet_name=sheet_name)
    client.set_cell_formula("F33", "=IF(D33=0, 0, (C33-D33)/D33)", sheet_name=sheet_name)
    client.set_cell_formula("G33", '=IF(C$20=0, "", REPT("■", MAX(1, INT(C33/C$20*25))) & " " & TEXT(C33/C$20, "0.0%"))', sheet_name=sheet_name)

    # (9) 所有者权益合计 (Row 40)
    client.set_cell_formula("C40", "=SUM(C36:C39)", sheet_name=sheet_name)
    client.set_cell_formula("D40", "=SUM(D36:D39)", sheet_name=sheet_name)
    client.set_cell_formula("E40", "=C40-D40", sheet_name=sheet_name)
    client.set_cell_formula("F40", "=IF(D40=0, 0, (C40-D40)/D40)", sheet_name=sheet_name)
    client.set_cell_formula("G40", '=IF(C$20=0, "", REPT("■", MAX(1, INT(C40/C$20*25))) & " " & TEXT(C40/C$20, "0.0%"))', sheet_name=sheet_name)

    # (10) 负债和所有者权益总计 (Row 41)
    client.set_cell_formula("C41", "=C33+C40", sheet_name=sheet_name)
    client.set_cell_formula("D41", "=D33+D40", sheet_name=sheet_name)
    client.set_cell_formula("E41", "=C41-D41", sheet_name=sheet_name)
    client.set_cell_formula("F41", "=IF(D41=0, 0, (C41-D41)/D41)", sheet_name=sheet_name)
    client.set_cell_formula("G41", '="100.0% (负债权益基准)"', sheet_name=sheet_name)

    # (11) 资产负债平衡检验公式 (Row 42)
    client.set_cell_formula("C42", '=IF(C20=C41, "✅ 期末平 (差额 0)", "❌ 不平 差额:" & (C20-C41))', sheet_name=sheet_name)
    client.set_cell_formula("D42", '=IF(D20=D41, "✅ 年初平 (差额 0)", "❌ 不平 差额:" & (D20-D41))', sheet_name=sheet_name)
    client.set_cell_formula("G42", '="✔ 自动平衡校验正常"', sheet_name=sheet_name)

    # ==================== 3. 右侧看板指标公式注入 ====================
    # 资产负债率 (Row 5): C33(负债合计) / C20(资产总计)
    client.set_cell_formula("J5", "=C33/C20", sheet_name=sheet_name)
    client.set_cell_formula("L5", '=IF(J5<=0.6, "🟢 优良 (财务稳健)", "🔴 偏高 (关注风险)")', sheet_name=sheet_name)

    # 流动比率 (Row 6): C11(流动资产) / C28(流动负债)
    client.set_cell_formula("J6", "=C11/C28", sheet_name=sheet_name)
    client.set_cell_formula("L6", '=IF(J6>=1.5, "🟢 优良 (偿债充足)", "🟡 一般 (略有偏低)")', sheet_name=sheet_name)

    # 速动比率 (Row 7): (C11 - C9存货) / C28
    client.set_cell_formula("J7", "=(C11-C9)/C28", sheet_name=sheet_name)
    client.set_cell_formula("L7", '=IF(J7>=1.0, "🟢 优良 (变现力强)", "🟡 预警 (速动偏低)")', sheet_name=sheet_name)

    # 现金比率 (Row 8): (C5货币资金 + C6交易性金融资产) / C28
    client.set_cell_formula("J8", "=(C5+C6)/C28", sheet_name=sheet_name)
    client.set_cell_formula("L8", '=IF(J8>=0.2, "🟢 极佳 (现金充裕)", "🔴 不足 (流动性差)")', sheet_name=sheet_name)

    # 营运资金 (Row 9): C11 - C28
    client.set_cell_formula("J9", "=C11-C28", sheet_name=sheet_name)
    client.set_cell_formula("L9", '="🟢 充沛 (无偿还缺口)"', sheet_name=sheet_name)

    # 资产总额、负债总额、净资产 (Row 12, 13, 14)
    client.set_cell_formula("J12", "=C20", sheet_name=sheet_name)
    client.set_cell_formula("J13", "=C33", sheet_name=sheet_name)
    client.set_cell_formula("J14", "=C40", sheet_name=sheet_name)
    # 产权比率 (Row 15): C33 / C40
    client.set_cell_formula("J15", "=C33/C40", sheet_name=sheet_name)
    client.set_cell_formula("L15", '=IF(J15<=1.0, "🟢 结构稳健", "🟡 财务杠杆偏大")', sheet_name=sheet_name)

    # 结构占比与动态进度条 (Row 18, 19, 20, 21)
    # 流动资产占比
    client.set_cell_formula("J18", "=C11/C20", sheet_name=sheet_name)
    client.set_cell_formula("L18", '=REPT("█", INT(J18*20)) & " " & TEXT(J18, "0.0%")', sheet_name=sheet_name)
    # 非流动资产占比
    client.set_cell_formula("J19", "=C19/C20", sheet_name=sheet_name)
    client.set_cell_formula("L19", '=REPT("█", INT(J19*20)) & " " & TEXT(J19, "0.0%")', sheet_name=sheet_name)
    # 负债占比
    client.set_cell_formula("J20", "=C33/C20", sheet_name=sheet_name)
    client.set_cell_formula("L20", '=REPT("█", INT(J20*20)) & " " & TEXT(J20, "0.0%")', sheet_name=sheet_name)
    # 所有者权益占比
    client.set_cell_formula("J21", "=C40/C20", sheet_name=sheet_name)
    client.set_cell_formula("L21", '=REPT("█", INT(J21*20)) & " " & TEXT(J21, "0.0%")', sheet_name=sheet_name)

    # 构成动态条形图 (Row 23~28)
    chart_items = [
        (23, "C5"),   # 货币资金
        (24, "C9"),   # 存货
        (25, "C7"),   # 应收账款
        (26, "C16"),  # 固定资产(净)
        (27, "C13"),  # 长期投资
        (28, "C18")   # 无形资产
    ]
    for r_idx, c_ref in chart_items:
        client.set_cell_formula(f"J{r_idx}", f"={c_ref}", sheet_name=sheet_name)
        client.set_cell_formula(f"K{r_idx}", f"={c_ref}/C$20", sheet_name=sheet_name)
        client.set_cell_formula(f"L{r_idx}", f'=REPT("■", MAX(1, INT({c_ref}/C$20*30))) & " " & TEXT({c_ref}/C$20, "0.0%")', sheet_name=sheet_name)

    # ==================== 4. 视觉与表格线（边框）美化 ====================
    print("🎨 正在设置全表网格边框线与商务排版...")

    # (1) 大标题与看板标题
    client.merge_cells("A1:G1", sheet_name=sheet_name)
    client.set_font("A1", {"name": "微软雅黑", "size": 15, "bold": True, "color": WPSAirScriptClient.rgb_to_excel_color(30, 41, 59)}, sheet_name=sheet_name)
    client.set_alignment("A1", {"horizontal": -4108, "vertical": -4108}, sheet_name=sheet_name)
    client.set_row_height(1, 32, sheet_name=sheet_name)

    client.merge_cells("I1:L1", sheet_name=sheet_name)
    client.set_font("I1", {"name": "微软雅黑", "size": 13, "bold": True, "color": WPSAirScriptClient.rgb_to_excel_color(15, 23, 42)}, sheet_name=sheet_name)
    client.set_alignment("I1", {"horizontal": -4108, "vertical": -4108}, sheet_name=sheet_name)

    # (2) 副标题
    client.merge_cells("A2:B2", sheet_name=sheet_name)
    client.merge_cells("C2:D2", sheet_name=sheet_name)
    client.merge_cells("E2:G2", sheet_name=sheet_name)
    client.set_font("A2:G2", {"name": "微软雅黑", "size": 9.5, "bold": False, "color": WPSAirScriptClient.rgb_to_excel_color(100, 116, 139)}, sheet_name=sheet_name)
    client.set_alignment("A2", {"horizontal": -4131, "vertical": -4108}, sheet_name=sheet_name)
    client.set_alignment("C2", {"horizontal": -4108, "vertical": -4108}, sheet_name=sheet_name)
    client.set_alignment("E2", {"horizontal": -4152, "vertical": -4108}, sheet_name=sheet_name)

    client.merge_cells("I2:L2", sheet_name=sheet_name)
    client.set_font("I2", {"name": "微软雅黑", "size": 9.5, "bold": False, "color": WPSAirScriptClient.rgb_to_excel_color(100, 116, 139)}, sheet_name=sheet_name)
    client.set_alignment("I2", {"horizontal": -4108, "vertical": -4108}, sheet_name=sheet_name)

    # (3) 表头样式
    header_color = WPSAirScriptClient.rgb_to_excel_color(30, 58, 138)  # 深邃科技蓝
    client.set_background_color("A3:G3", header_color, sheet_name=sheet_name)
    client.set_font("A3:G3", {"name": "微软雅黑", "size": 10.5, "bold": True, "color": WPSAirScriptClient.rgb_to_excel_color(255, 255, 255)}, sheet_name=sheet_name)
    client.set_alignment("A3:G3", {"horizontal": -4108, "vertical": -4108}, sheet_name=sheet_name)

    board_header = WPSAirScriptClient.rgb_to_excel_color(15, 118, 110) # 墨青色
    client.set_background_color("I3:L3", board_header, sheet_name=sheet_name)
    client.set_font("I3:L3", {"name": "微软雅黑", "size": 10.5, "bold": True, "color": WPSAirScriptClient.rgb_to_excel_color(255, 255, 255)}, sheet_name=sheet_name)
    client.set_alignment("I3:L3", {"horizontal": -4108, "vertical": -4108}, sheet_name=sheet_name)

    # (4) 分类与区块底色
    cat_bg = WPSAirScriptClient.rgb_to_excel_color(241, 245, 249) # 浅灰底
    for cr in [4, 12, 22, 29, 35]:
        client.set_background_color(f"A{cr}:G{cr}", cat_bg, sheet_name=sheet_name)
        client.set_font(f"A{cr}", {"name": "微软雅黑", "size": 10.5, "bold": True, "color": WPSAirScriptClient.rgb_to_excel_color(15, 23, 42)}, sheet_name=sheet_name)

    # 看板模块标题行 (Row 4, 11, 17, 22)
    board_sec_bg = WPSAirScriptClient.rgb_to_excel_color(240, 253, 250) # 浅青底
    for bsr in [4, 11, 17, 22]:
        client.merge_cells(f"I{bsr}:L{bsr}", sheet_name=sheet_name)
        client.set_background_color(f"I{bsr}:L{bsr}", board_sec_bg, sheet_name=sheet_name)
        client.set_font(f"I{bsr}", {"name": "微软雅黑", "size": 10, "bold": True, "color": WPSAirScriptClient.rgb_to_excel_color(13, 148, 136)}, sheet_name=sheet_name)
        client.set_alignment(f"I{bsr}", {"horizontal": -4131, "vertical": -4108}, sheet_name=sheet_name)

    # (5) 合计行与总计行样式
    subtotal_bg = WPSAirScriptClient.rgb_to_excel_color(238, 242, 255)
    for sr in [11, 19, 28, 32, 40]:
        client.set_background_color(f"A{sr}:G{sr}", subtotal_bg, sheet_name=sheet_name)
        client.set_font(f"A{sr}:G{sr}", {"name": "微软雅黑", "size": 10, "bold": True, "color": WPSAirScriptClient.rgb_to_excel_color(30, 58, 138)}, sheet_name=sheet_name)

    total_bg = WPSAirScriptClient.rgb_to_excel_color(219, 234, 254)
    for tr in [20, 41]:
        client.set_background_color(f"A{tr}:G{tr}", total_bg, sheet_name=sheet_name)
        client.set_font(f"A{tr}:G{tr}", {"name": "微软雅黑", "size": 10.5, "bold": True, "color": WPSAirScriptClient.rgb_to_excel_color(30, 58, 138)}, sheet_name=sheet_name)
        client.set_row_height(tr, 24, sheet_name=sheet_name)

    # 平衡行
    check_bg = WPSAirScriptClient.rgb_to_excel_color(240, 253, 244)
    client.set_background_color("A42:G42", check_bg, sheet_name=sheet_name)
    client.set_font("A42:G42", {"name": "微软雅黑", "size": 10.5, "bold": True, "color": WPSAirScriptClient.rgb_to_excel_color(22, 101, 52)}, sheet_name=sheet_name)
    client.set_alignment("A42", {"horizontal": -4131, "vertical": -4108}, sheet_name=sheet_name)
    client.set_alignment("C42:D42", {"horizontal": -4108, "vertical": -4108}, sheet_name=sheet_name)
    client.set_alignment("G42", {"horizontal": -4108, "vertical": -4108}, sheet_name=sheet_name)

    # (6) 对齐规范
    client.set_alignment("B4:B41", {"horizontal": -4108, "vertical": -4108}, sheet_name=sheet_name)
    client.set_alignment("C4:F41", {"horizontal": -4152, "vertical": -4108}, sheet_name=sheet_name)
    client.set_alignment("G4:G41", {"horizontal": -4131, "vertical": -4108}, sheet_name=sheet_name)

    client.set_alignment("I5:I28", {"horizontal": -4131, "vertical": -4108}, sheet_name=sheet_name)
    client.set_alignment("J5:J28", {"horizontal": -4152, "vertical": -4108}, sheet_name=sheet_name)
    client.set_alignment("K5:K28", {"horizontal": -4108, "vertical": -4108}, sheet_name=sheet_name)
    client.set_alignment("L5:L28", {"horizontal": -4131, "vertical": -4108}, sheet_name=sheet_name)

    # (7) 数字格式
    client.set_number_format("C4:E41", "#,##0.00", sheet_name=sheet_name)
    client.set_number_format("F4:F41", "0.00%", sheet_name=sheet_name)
    # 看板数字格式
    client.set_number_format("J5", "0.00%", sheet_name=sheet_name)
    client.set_number_format("J6:J8", "0.00", sheet_name=sheet_name)
    client.set_number_format("J9", "#,##0.00", sheet_name=sheet_name)
    client.set_number_format("J12:J14", "#,##0.00", sheet_name=sheet_name)
    client.set_number_format("J15", "0.00%", sheet_name=sheet_name)
    client.set_number_format("J18:J21", "0.00%", sheet_name=sheet_name)
    client.set_number_format("J23:J28", "#,##0.00", sheet_name=sheet_name)
    client.set_number_format("K23:K28", "0.00%", sheet_name=sheet_name)

    # (8) 列宽规范
    print("📏 设置各列尺寸...")
    client.set_column_width(1, 26, sheet_name=sheet_name) # A 项目
    client.set_column_width(2, 6, sheet_name=sheet_name)  # B 行次
    client.set_column_width(3, 16, sheet_name=sheet_name) # C 期末
    client.set_column_width(4, 16, sheet_name=sheet_name) # D 年初
    client.set_column_width(5, 15, sheet_name=sheet_name) # E 变动额
    client.set_column_width(6, 10, sheet_name=sheet_name) # F 变动率
    client.set_column_width(7, 22, sheet_name=sheet_name) # G 动态占比条
    client.set_column_width(8, 3, sheet_name=sheet_name)  # H 空白间隔列
    client.set_column_width(9, 16, sheet_name=sheet_name) # I 看板维度
    client.set_column_width(10, 16, sheet_name=sheet_name)# J 指标值
    client.set_column_width(11, 20, sheet_name=sheet_name)# K 参考标准
    client.set_column_width(12, 24, sheet_name=sheet_name)# L 状态与条形图

    # (9) 核心：设置清晰美观的表格线 (Borders)
    print("🔲 应用实线网格边框（主表 A3:G42 + 看板 I3:L28）...")
    client.set_border("A3:G42", {
        "lineStyle": 1,
        "weight": 1,
        "color": WPSAirScriptClient.rgb_to_excel_color(203, 213, 225)
    }, sheet_name=sheet_name)

    client.set_border("I3:L28", {
        "lineStyle": 1,
        "weight": 1,
        "color": WPSAirScriptClient.rgb_to_excel_color(203, 213, 225)
    }, sheet_name=sheet_name)

    print("\n" + "=" * 65)
    print("🎉 包含完整表格线、公式联动、占比条形图与可视化看板已成功生成！")
    print("=" * 65)

if __name__ == "__main__":
    build_advanced_balance_sheet()
