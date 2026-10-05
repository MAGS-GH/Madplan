using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Madplan.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddIngredientImageUrl : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ImageUrl",
                table: "RecipeIngredients",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ImageUrl",
                table: "RecipeIngredients");
        }
    }
}
