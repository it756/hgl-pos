"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { saveCategory, setCategoryActive } from "../../app/(app)/catalog/actions";
import type { CategoryRow } from "../../lib/catalog/service";
import { INITIAL_ACTION_STATE, SELECT_CLASS } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function CategoriesTab({ categories, skuCounts, canEdit }: { categories: CategoryRow[]; skuCounts: Record<string, number>; canEdit: boolean }) {
  const router = useRouter();
  const nameById = useMemo(() => new Map(categories.map((c) => [c.category_id, c.name])), [categories]);
  const [editing, setEditing] = useState<CategoryRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-md">
      {canEdit && (
        <div>
          <Button type="button" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" />
            Add category
          </Button>
        </div>
      )}
      {error !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Parent</TableHead>
            <TableHead className="text-right">SKUs</TableHead>
            <TableHead>Status</TableHead>
            {canEdit && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((category) => (
            <TableRow key={category.category_id}>
              <TableCell className="font-medium text-on-surface">{category.code}</TableCell>
              <TableCell>{category.name}</TableCell>
              <TableCell>{category.parent_category_id === null ? "—" : (nameById.get(category.parent_category_id) ?? "—")}</TableCell>
              <TableCell className="text-right">{skuCounts[category.category_id] ?? 0}</TableCell>
              <TableCell>
                <Badge variant={category.is_active ? "success" : "outline"}>{category.is_active ? "Active" : "Inactive"}</Badge>
              </TableCell>
              {canEdit && (
                <TableCell className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(category)}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant={category.is_active ? "destructive" : "secondary"}
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setCategoryActive(category.category_id, !category.is_active);
                        setError(result.error);
                        router.refresh();
                      })
                    }
                  >
                    {category.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
          {categories.length === 0 && (
            <TableRow>
              <TableCell colSpan={canEdit ? 6 : 5} className="text-center text-on-surface-variant">
                No categories yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent>
          {editing !== null && (
            <CategoryForm
              key={editing === "new" ? "new" : editing.category_id}
              category={editing === "new" ? null : editing}
              categories={categories}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CategoryForm({ category, categories, onDone }: { category: CategoryRow | null; categories: CategoryRow[]; onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveCategory, INITIAL_ACTION_STATE);
  useEffect(() => {
    if (state.success) {
      onDone();
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <form action={formAction} className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>{category === null ? "Add category" : `Edit ${category.name}`}</SheetTitle>
      </SheetHeader>
      {category !== null && <input type="hidden" name="category_id" value={category.category_id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-code">Code</Label>
        <Input id="category-code" name="code" defaultValue={category?.code} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-name">Name</Label>
        <Input id="category-name" name="name" defaultValue={category?.name} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category-parent">Parent category</Label>
        <select id="category-parent" name="parent_category_id" className={SELECT_CLASS} defaultValue={category?.parent_category_id ?? ""}>
          <option value="">— None —</option>
          {categories
            .filter((option) => option.category_id !== category?.category_id)
            .map((option) => (
              <option key={option.category_id} value={option.category_id}>
                {option.name}
              </option>
            ))}
        </select>
      </div>
      {state.error !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{state.error}</p>}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save category"}
        </Button>
      </SheetFooter>
    </form>
  );
}
