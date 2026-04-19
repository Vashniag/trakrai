import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

type StatCardProps = Readonly<{
  description: string;
  title: string;
  value: number | string;
}>;

export const StatCard = ({ description, title, value }: StatCardProps) => (
  <Card className="border">
    <CardHeader className="border-b pb-3">
      <CardDescription className="text-[11px] tracking-[0.18em] uppercase">{title}</CardDescription>
      <CardTitle className="text-3xl tracking-tight">{value}</CardTitle>
    </CardHeader>
    <CardContent className="text-muted-foreground pt-4 text-sm">{description}</CardContent>
  </Card>
);
