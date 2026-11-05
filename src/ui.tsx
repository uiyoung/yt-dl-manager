// 여러 화면에서 같이 쓰는 기본 부품과 클래스 묶음
import type { ButtonHTMLAttributes, Ref } from 'react';

/** 조건부 클래스 이름을 이어 붙인다 (거짓 값은 뺀다) */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/** 입력칸·선택칸·여러 줄 입력의 기본 모양 */
// 사용할 수 없을 때는 브라우저 기본처럼 흐리게
export const control = 'rounded-md border border-line bg-panel px-2 py-1.5 disabled:opacity-70';

/** 모든 버튼이 공유하는 바탕: 아이콘과 글자를 가운데 맞춰 나란히 */
export const buttonBase =
  'inline-flex items-center justify-center gap-[5px] whitespace-nowrap cursor-pointer disabled:cursor-default disabled:opacity-45';

type Variant = 'default' | 'primary' | 'ghost' | 'retry';

/**
 * 변형별 클래스. Tailwind는 같은 속성을 정하는 클래스가 둘이면 class 순서가 아니라
 * 생성된 CSS 순서로 이기는 쪽이 정해지므로, 속성마다 클래스가 하나만 나오게 고른다.
 */
function variantClasses(variant: Variant, icon: boolean, dangerHover: boolean, active: boolean) {
  const hover = dangerHover
    ? 'enabled:hover:bg-error-bg enabled:hover:text-error'
    : variant === 'primary'
      ? 'enabled:hover:brightness-[1.08]'
      : cx('enabled:hover:bg-hover', variant === 'ghost' && icon && 'enabled:hover:text-fg');
  switch (variant) {
    case 'primary':
      return cx('border-accent bg-accent text-accent-fg font-semibold', hover);
    case 'retry':
      return cx('border-error bg-panel text-error', hover);
    case 'ghost':
      return cx('border-transparent', active ? 'bg-hover text-fg' : 'bg-transparent text-dim', hover);
    default:
      return cx('border-line', active ? 'bg-hover' : 'bg-panel', hover);
  }
}

export function Button({
  variant = 'default',
  icon = false,
  dangerHover = false,
  active = false,
  className,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** 32px 정사각형 아이콘 버튼 */
  icon?: boolean;
  /** 마우스를 올리면 빨갛게 (지우기 버튼) */
  dangerHover?: boolean;
  /** 메뉴가 열려 있는 등 눌린 상태 */
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      className={cx(
        buttonBase,
        'rounded-md border',
        icon ? 'size-8 p-1.5' : 'px-3 py-1.5',
        variantClasses(variant, icon, dangerHover, active),
        className,
      )}
      {...rest}
    />
  );
}

/** 상태 표시 작은 알약 */
export function Badge({ tone, children }: { tone?: 'info' | 'error'; children: React.ReactNode }) {
  return (
    <span
      className={cx(
        'shrink-0 whitespace-nowrap rounded-[10px] px-[7px] py-px text-[11px]',
        tone === 'info' ? 'bg-info-bg text-info' : tone === 'error' ? 'bg-error-bg text-error' : 'bg-hover text-dim',
      )}
    >
      {children}
    </span>
  );
}

// 대기열·완료 목록이 같이 쓰는 클래스 묶음
export const viewClass = 'flex min-h-0 flex-1 flex-col gap-2.5';
export const listClass = 'flex-1 overflow-y-auto rounded-lg border border-line bg-panel';
export const rowClass = 'flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0';
export const emptyClass =
  'flex flex-1 items-center justify-center rounded-lg border border-dashed border-line bg-panel text-dim';
export const thumbClass = 'h-[63px] w-[112px] shrink-0 rounded-[4px] bg-bar object-cover';
export const actionsClass = 'flex min-w-[190px] shrink-0 justify-end gap-1.5';
