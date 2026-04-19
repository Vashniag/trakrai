type StatCardProps = Readonly<{
  title: string;
  value: number | string;
}>;

export const StatCard = ({ title, value }: StatCardProps) => (
  <div className="border p-2">
    <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">{title}</div>
    <div className="text-3xl tracking-tight">{value}</div>
  </div>
);
