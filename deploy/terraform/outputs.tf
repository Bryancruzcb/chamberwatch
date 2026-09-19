output "url" {
  description = "The demo, once the first boot has built the image and Caddy has its certificate."
  value       = "https://${local.domain}"
}

output "public_ip" {
  description = "The Elastic IP the sslip.io name points at."
  value       = aws_eip.demo.public_ip
}

output "instance_id" {
  description = "The box, for Session Manager."
  value       = aws_instance.box.id
}

output "session_command" {
  description = "Opens a shell on the box. Needs the Session Manager plugin."
  value       = "aws ssm start-session --region ${local.region} --target ${aws_instance.box.id}"
}
