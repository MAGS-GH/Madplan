using Madplan.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Madplan.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<MealPlan> MealPlans => Set<MealPlan>();
    public DbSet<MealPlanEntry> MealPlanEntries => Set<MealPlanEntry>();
    public DbSet<ShoppingList> ShoppingLists => Set<ShoppingList>();
    public DbSet<ShoppingItem> ShoppingItems => Set<ShoppingItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Recipe>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Title).HasMaxLength(200).IsRequired();
            e.HasMany(x => x.Ingredients)
                .WithOne(x => x.Recipe!)
                .HasForeignKey(x => x.RecipeId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RecipeIngredient>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.Unit).HasMaxLength(40);
            e.HasOne(x => x.Product)
                .WithMany()
                .HasForeignKey(x => x.ProductId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Product>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(300).IsRequired();
            e.Property(x => x.Brand).HasMaxLength(200);
            e.Property(x => x.Barcode).HasMaxLength(64);
            e.HasIndex(x => x.Barcode);
            e.Property(x => x.Source).HasMaxLength(40);
        });

        modelBuilder.Entity<MealPlan>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.WeekStart);
            e.HasMany(x => x.Entries)
                .WithOne(x => x.MealPlan!)
                .HasForeignKey(x => x.MealPlanId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<MealPlanEntry>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Recipe)
                .WithMany()
                .HasForeignKey(x => x.RecipeId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ShoppingList>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Title).HasMaxLength(200);
            e.HasMany(x => x.Items)
                .WithOne(x => x.ShoppingList!)
                .HasForeignKey(x => x.ShoppingListId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.MealPlan)
                .WithMany()
                .HasForeignKey(x => x.MealPlanId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<ShoppingItem>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.Unit).HasMaxLength(40);
        });
    }
}
