import { Card, CardHeader, CardTitle } from '@trakrai/design-system/components/card';

type StatCardProps = Readonly<{
  description: string;
  title: string;
  value: number | string;
}>;

export const StatCard = ({ description: _description, title, value }: StatCardProps) => (
  <Card className="border">
    <CardHeader className="border-b pb-4">
      <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">{title}</div>
      <CardTitle className="text-3xl tracking-tight">{value}</CardTitle>
    </CardHeader>
  </Card>
);
