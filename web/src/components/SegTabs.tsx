import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type SegTabOption = {
  value: string;
  label: string;
  className?: string;
};

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SegTabOption[];
  ariaLabel?: string;
  className?: string;
  listClassName?: string;
  full?: boolean;
  disabled?: boolean;
};

export default function SegTabs({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
  listClassName,
  full = false,
  disabled = false,
}: Props) {
  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      className={cn("shrink-0", full && "w-full max-w-full", className)}
    >
      <TabsList
        aria-label={ariaLabel}
        className={cn(full && "flex h-10 w-full", listClassName)}
      >
        {options.map((opt) => (
          <TabsTrigger
            key={opt.value}
            value={opt.value}
            disabled={disabled}
            className={cn(full && "flex-1", opt.className)}
          >
            {opt.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
