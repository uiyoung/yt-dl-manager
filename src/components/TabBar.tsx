import { useStore } from '../store';
import { buttonBase, cx } from '../ui';
import { DoneIcon, QueueIcon, SettingsIcon } from '../icons';

export type Tab = 'queue' | 'done' | 'settings';

/** 탭 버튼: 아래 밑줄로 현재 탭을 표시 */
function tabClass(active: boolean) {
  return cx(
    buttonBase,
    'border-b-2 px-3.5 py-2 enabled:hover:bg-hover',
    active ? 'border-highlight font-semibold text-fg' : 'border-transparent text-dim',
  );
}

/** 위쪽 탭 줄: queue(남은 개수 배지), done, 오른쪽 끝에 settings 톱니바퀴 */
export function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  // 완료되지 않은 항목 수
  const queueCount = useStore((state) => {
    let count = 0;
    for (const video of Object.values(state.videos)) {
      if (video.status !== 'done') {
        count++;
      }
    }

    return count;
  });

  const tabProps = (id: Tab) => ({
    role: 'tab',
    'aria-selected': tab === id,
    onClick: () => onChange(id),
  });

  return (
    <nav className='flex gap-1 border-b border-line' role='tablist'>
      <button className={tabClass(tab === 'queue')} {...tabProps('queue')}>
        <QueueIcon />
        queue
        {/* 대기열에 항목이 있으면 파란색으로, 비었으면 흐리게 */}
        <span
          className={cx(
            'rounded-[10px] px-1.75 py-px text-[12px] tabular-nums',
            queueCount ? 'bg-info-bg font-semibold text-info' : 'bg-hover text-dim',
          )}
        >
          {queueCount}
        </span>
      </button>

      <button className={tabClass(tab === 'done')} {...tabProps('done')}>
        <DoneIcon />
        done
      </button>

      {/* 설정은 오른쪽 끝에 톱니바퀴 아이콘만 */}
      <button
        className={cx(tabClass(tab === 'settings'), 'ml-auto px-2.5')}
        {...tabProps('settings')}
        title='Settings'
        aria-label='Settings'
      >
        <SettingsIcon />
      </button>
    </nav>
  );
}
