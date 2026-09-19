# The instance's role lets Session Manager in, so the box needs no SSH port or key. Nothing else.

data "aws_iam_policy_document" "box_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "box" {
  name               = "chamberwatch-demo"
  assume_role_policy = data.aws_iam_policy_document.box_trust.json
}

resource "aws_iam_role_policy_attachment" "box_ssm" {
  role       = aws_iam_role.box.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "box" {
  name = "chamberwatch-demo"
  role = aws_iam_role.box.name
}
