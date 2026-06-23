"""Command-line interface for MeshPlanner."""
import click


@click.group()
def cli():
    """LoRa Network Site Planner for Disaster Recovery."""
    pass


@cli.command()
@click.option("--west", type=float, required=True, help="West longitude of bounding box")
@click.option("--south", type=float, required=True, help="South latitude of bounding box")
@click.option("--east", type=float, required=True, help="East longitude of bounding box")
@click.option("--north", type=float, required=True, help="North latitude of bounding box")
def coverage(west, south, east, north):
    """Simulate coverage for a bounding box area."""
    click.echo(f"Coverage simulation for bbox: {west},{south},{east},{north}")


@cli.command()
@click.option("--sites", type=click.Path(exists=True), required=True, help="Candidate sites file (CSV/GeoJSON)")
@click.option("--target", type=float, default=0.95, help="Coverage target fraction (default: 0.95)")
def optimize(sites, target):
    """Run site selection optimization."""
    click.echo(f"Optimizing {sites} for {target*100:.0f}% coverage target")
