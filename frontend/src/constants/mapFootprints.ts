/** 地圖縮放達此級以上才向 API 請求 footprint（避免遠景無謂請求） */
export const FOOTPRINT_MIN_ZOOM = 15;

/** 分區定位／自動飛行後至少維持此縮放，確保 footprint 可見 */
export const FOOTPRINT_FIT_MIN_ZOOM = FOOTPRINT_MIN_ZOOM;
