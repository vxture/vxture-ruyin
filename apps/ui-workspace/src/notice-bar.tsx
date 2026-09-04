/**
 * 页面顶部那条提醒 —— **可以关掉**（owner 2026-09-04 第 2 条）。
 *
 * 它讲的是「刚才那个动作的结果」：读完就没用了。不给关，它会一直占着内容区
 * 顶部，直到用户换一页；而换页才让它消失，会让人以为提醒和当前这页有关。
 *
 * 单独一个文件、工作台与设置页共用：两处此前各写一遍 `.error-box`，一处加了
 * 关闭按钮另一处没加，就是同一个东西两种行为。
 *
 * **不是所有错误都用它。** 贴在某个失败操作旁边的错误框不给关闭按钮 —— 那不是
 * 通知，是那块内容当前的状态，关掉它等于把状态藏起来。
 */
import { Icon } from "@vxture/design-system";

export function NoticeBar({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="error-box notice-bar" role="status">
      <span>{message}</span>
      <button
        type="button"
        className="notice-bar-close"
        aria-label="关闭提醒"
        onClick={onClose}
      >
        <Icon name="x" size="xs" />
      </button>
    </div>
  );
}
