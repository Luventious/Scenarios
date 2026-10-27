// 场景矩阵数据契约：出行半径(径向 4 层) x 关系半径(角度 6 类)

export type RadiusKey = "r1" | "r2" | "r3" | "r4";

export type RelationKey =
  | "solo"
  | "intimate"
  | "family"
  | "pet"
  | "interest"
  | "business";

/** 单个车生活场景 */
export interface SceneItem {
  id: string;
  /** 场景名称，如「早餐飞奔啦」 */
  name: string;
  /** 出行半径层级 */
  radius: RadiusKey;
  /** 关系半径分类 */
  relation: RelationKey;
  /** 场景释义 */
  description: string;
  /**
   * 占比（飞书《占比》字段）：驱动 R3/R4 格子面积分配的权重。
   * 表中为「高/中/低」档位单选，映射为相对权重 高=3 / 中=2 / 低=1；
   * 数值型（小数或百分数）直接采用。缺省时与其他场景等权。
   */
  weight?: number;
  /** 《占比》原始档位文本（如「高」「中」「低」「30%」），用于详情展示 */
  weightLabel?: string;
}

/** 渐变停靠点：[位置 0~1, 颜色]，位置对应源渐变 0%~100%（0 贴该层内圈、1 贴层外沿） */
export type GradientStop = [number, string];

/**
 * 分区纹理（极坐标映射）：
 * - parallel：纹理线与渐变流向平行 → 扇面上呈放射细线（笔刷纹）
 * - cross：纹理线与渐变流向垂直 → 扇面上呈同心弧线（纸张纹）
 */
export interface RadiusTexture {
  orient: "parallel" | "cross";
  /** 线条颜色（含透明度） */
  color: string;
  /** 线条粗细 px */
  width: number;
  /** 线条间距 px（沿渐变轴方向） */
  period: number;
}

/** 出行半径元数据 */
export interface RadiusMeta {
  key: RadiusKey;
  name: string;
  subtitle: string;
  /** 基准色（渐变深端），用于图例/悬停发光/筛选 chips */
  color: string;
  /**
   * 同色系渐变停靠点（位置 0~1，源渐变起点 0 贴该层内圈、终点 1 贴层外沿）：
   * 扇形填充按径向展开为整体渐变面料（同一半径处所有格子取同一色，
   * 缺省回退纯色 color）
   */
  gradient?: GradientStop[];
  /** 分区织纹（缺省无纹理） */
  texture?: RadiusTexture;
  description: string;
}

/** 关系半径元数据 */
export interface RelationMeta {
  key: RelationKey;
  name: string;
  description: string;
}

/** 完整数据集（与来源解耦，可来自内置数据或飞书多维表格） */
export interface SceneDataset {
  source: "builtin" | "feishu";
  radii: RadiusMeta[];
  relations: RelationMeta[];
  scenes: SceneItem[];
  /** 飞书来源：因字段缺失/标签未识别而被跳过的记录数（部分跳过时仍返回其余场景） */
  skippedCount?: number;
  fetchedAt: string;
}
