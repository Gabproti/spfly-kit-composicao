export type Role = "admin" | "operator";
export type Profile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  created_at?: string;
};
export type Product = {
  id: string;
  code: string;
  description: string;
  image_url: string | null;
  active: boolean;
};
export type Component = Product & { type: string | null };
export type CompositionItem = {
  component_id: string;
  quantity: number;
  component?: Component;
};
export type Kit = {
  product: Product;
  items: {
    code: string;
    image_url: string | null;
    type: string | null;
    description: string;
    quantity: number;
  }[];
};
export type History = {
  id: string;
  product_code: string;
  created_at: string;
  user_id: string;
  products: { description: string } | null;
  profiles: { name: string; email: string } | null;
};
