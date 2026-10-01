using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Madplan.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMealEntryDays : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Days",
                table: "MealPlanEntries",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Days",
                table: "MealPlanEntries");
        }
    }
}
