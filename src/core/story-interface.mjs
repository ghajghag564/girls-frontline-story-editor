export class StoryInterfaceRenderer {
  narration(context, x, y, width, height) {
    context.save();
    context.fillStyle = 'rgba(18, 27, 35, 0.92)';
    context.fillRect(x, y, width, height);
    context.fillStyle = '#8ac1bc';
    context.fillRect(x, y, 4, height);
    context.restore();
  }

  continuation(context, x, y) {
    context.save();
    context.fillStyle = '#f2f5f7';
    context.beginPath();
    context.moveTo(x - 5, y - 3);
    context.lineTo(x + 5, y - 3);
    context.lineTo(x, y + 3);
    context.closePath();
    context.fill();
    context.restore();
  }
}
