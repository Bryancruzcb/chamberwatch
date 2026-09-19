data "aws_vpc" "default" {
  default = true
}

# Not every zone in the region offers every instance type.
data "aws_ec2_instance_type_offerings" "box" {
  location_type = "availability-zone"

  filter {
    name   = "instance-type"
    values = [var.instance_type]
  }
}

data "aws_subnets" "box" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }

  filter {
    name   = "availability-zone"
    values = data.aws_ec2_instance_type_offerings.box.locations
  }
}

# Canonical publishes the current Ubuntu 24.04 AMI ID under this public name.
data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id"
}

# Security groups don't filter the VPC DNS resolver or the time service, so those need no rules.
resource "aws_security_group" "box" {
  name        = "chamberwatch-demo"
  description = "HTTP and HTTPS in for Caddy. The owner reaches the box through SSM, not SSH."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTPS to Caddy"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP to Caddy, for the certificate challenge and the redirect to HTTPS"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTPS to SSM, GitHub, Docker Hub, Maven Central, npm, Zenodo and the certificate authority"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTP to the Ubuntu package mirrors"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "chamberwatch-demo"
  }
}

# Allocated before the instance, so its address can go into the instance's sslip.io name.
resource "aws_eip" "demo" {
  domain = "vpc"

  tags = {
    Name = "chamberwatch-demo"
  }
}

resource "aws_instance" "box" {
  #checkov:skip=CKV_AWS_126:Detailed monitoring is billed per metric, and a demo does not need it.
  ami                    = data.aws_ssm_parameter.ubuntu_ami.insecure_value
  instance_type          = var.instance_type
  subnet_id              = sort(data.aws_subnets.box.ids)[0]
  vpc_security_group_ids = [aws_security_group.box.id]
  iam_instance_profile   = aws_iam_instance_profile.box.name
  # outbound works from the first second of boot, before the Elastic IP is associated
  associate_public_ip_address = true

  # LF on every machine, so a Windows checkout renders the same user_data as any other.
  user_data = replace(templatefile("${path.module}/cloud-init.yaml", {
    domain  = local.domain
    git_ref = var.git_ref
    swap_gb = var.swap_gb
  }), "\r\n", "\n")

  # cloud-init only runs on a fresh instance, so a change to it has to replace the instance.
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    encrypted             = true
    delete_on_termination = true
  }

  lifecycle {
    # Canonical republishes the AMI often. Taking a new one only when the instance is recreated keeps a
    # later apply from replacing a running demo.
    ignore_changes = [ami]
  }

  tags = {
    Name = "chamberwatch-demo"
  }
}

resource "aws_eip_association" "demo" {
  instance_id   = aws_instance.box.id
  allocation_id = aws_eip.demo.id
}
