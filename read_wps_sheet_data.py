"""
WPS 智能表格纯只读读取工具（安全只读模式）
【安全承诺】：此脚本只包含只读查询逻辑，绝不执行任何写入、修改、删除、清空或格式变更操作！
"""

import sys
from typing import List, Any, Optional
from wps_airscript_client import WPSAirScriptClient
from config import get_workhours_config

# 从环境变量/.env中读取配置
NEW_FILE_ID, NEW_TOKEN, NEW_SCRIPT_ID, _ = get_workhours_config()


class SafeWPSReader:
    """WPS 智能表格安全只读客户端包装器"""

    def __init__(self, file_id: str, token: str, script_id: str):
        self.client = WPSAirScriptClient(file_id, token, script_id)

    def get_sheets(self) -> List[str]:
        """获取工作簿中所有的工作表名称（纯只读）"""
        return self.client.get_workbook_sheets()

    def get_used_data(self, sheet_name: Optional[str] = None) -> List[List[Any]]:
        """
        获取指定工作表的所有已用区域数据（纯只读）
        
        Args:
            sheet_name: 工作表名称（为空则默认第一个或当前活动表）
        """
        # isGetData="是" 表示获取实际数据内容
        return self.client.get_used_range_data(isGetData="是", sheet_name=sheet_name)

    def get_range(self, address: str, sheet_name: Optional[str] = None) -> List[List[Any]]:
        """
        获取指定区域的数据（纯只读）
        
        Args:
            address: 范围地址，如 "A1:E20"
            sheet_name: 工作表名称
        """
        res = self.client.get_range_values(address=address, sheet_name=sheet_name)
        if isinstance(res, list) and len(res) > 0 and isinstance(res[0], dict) and "data" in res[0]:
            return res[0]["data"]
        return res

    def get_cell(self, address: str, sheet_name: Optional[str] = None) -> Any:
        """
        获取指定单个单元格的值（纯只读）
        
        Args:
            address: 单元格地址，如 "A1"
            sheet_name: 工作表名称
        """
        res = self.client.get_cell_value(address=address, sheet_name=sheet_name)
        if isinstance(res, list) and len(res) > 0 and isinstance(res[0], dict) and "value" in res[0]:
            return res[0]["value"]
        return res

    def get_cell_formula(self, address: str, sheet_name: Optional[str] = None) -> Any:
        """
        获取指定单元格的公式（纯只读）
        """
        res = self.client.get_cell_formula(address=address, sheet_name=sheet_name)
        if isinstance(res, list) and len(res) > 0 and isinstance(res[0], dict) and "formula" in res[0]:
            return res[0]["formula"]
        return res


def print_table_preview(data: List[List[Any]], max_rows: int = 30):
    """格式化打印表格数据预览"""
    if not data or not isinstance(data, list):
        print("（无数据）")
        return

    # 规范化行列表
    rows = data[:max_rows]
    total_rows = len(data)

    print(f"\n📊 【数据预览（共 {total_rows} 行，显示前 {len(rows)} 行）】:")
    print("-" * 80)
    for idx, row in enumerate(rows, start=1):
        formatted_row = [str(cell) if cell is not None else "" for cell in row]
        # 控制每一格的显示长度
        row_str = " | ".join(f"{item:<15}" if len(item) < 15 else f"{item[:12]}..." for item in formatted_row)
        print(f"第 {idx:2d} 行: {row_str}")
    print("-" * 80)
    if total_rows > max_rows:
        print(f"... 还有 {total_rows - max_rows} 行数据未展开")


if __name__ == "__main__":
    print("🔒 启动纯只读检测与数据读取器...")
    reader = SafeWPSReader(NEW_FILE_ID, NEW_TOKEN, NEW_SCRIPT_ID)

    # 1. 查询所有工作表
    sheets = reader.get_sheets()
    print(f"📑 发现工作表列表: {sheets}")

    # 2. 对每个工作表做只读概览检测
    for s_name in sheets:
        print(f"\n🔍 正在读取工作表 [{s_name}] 的已用区域数据...")
        try:
            used_data = reader.get_used_data(sheet_name=s_name)
            print_table_preview(used_data)
        except Exception as e:
            print(f"  读取工作表 [{s_name}] 失败: {e}")
